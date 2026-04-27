/**
 * Meta WhatsApp Cloud API client.
 *
 * Supports direct Meta endpoints and Kapso-style proxies via `apiBaseUrl`.
 * Kapso signs with `X-Api-Key`; Meta signs with `Authorization: Bearer …`.
 *
 * Config is injected, not read from env — the consuming app resolves
 * per-tenant credentials (each agency / corp brings its own WABA + token)
 * and constructs a client per request.
 */

export interface WhatsAppClientConfig {
  phoneNumberId: string;
  accessToken: string;
  /** Override for Meta Cloud API. Defaults to graph.facebook.com v21.0. */
  apiBaseUrl?: string;
  /**
   * Optional fire-and-forget hook invoked after every successful send.
   * Apps wire this to their audit log so every wamid is reconcilable
   * with the corresponding inbound `messages.statuses` update (which
   * arrives later, on the inbound webhook).
   *
   * Failures are caught and logged here — never thrown — so an audit
   * outage never breaks the send hot path.
   */
  onSent?: (event: WhatsAppSendEvent) => Promise<void> | void;

  /**
   * Optional fire-and-forget hook invoked after every HTTP request
   * (success OR failure, including each retry). Closes the
   * "external API call log" gap in operator observability —
   * apps wire this to their `WhatsAppApiLog` writer so failed Meta
   * calls + slow calls show up next to inbound webhook deliveries
   * in the inbox UI.
   */
  onApiCall?: (event: WhatsAppApiCallEvent) => Promise<void> | void;
}

export interface WhatsAppApiCallEvent {
  /** HTTP method — pass-through. */
  method: string;
  /**
   * Path *shape*, with dynamic ids replaced by `{id}` so logs
   * aggregate per endpoint without exploding. e.g. `/messages`,
   * `/{phone_number_id}/media`. The client emits the shape; the
   * audit writer doesn't need to normalize again.
   */
  endpoint: string;
  /** 0 when the request never completed (DNS / network / timeout). */
  statusCode: number;
  durationMs: number;
  ok: boolean;
  /** Up to 280-char compact error on non-2xx. */
  errorMessage?: string;
  /** Which attempt this was (1, 2, 3 — bounded by MAX_ATTEMPTS=3). */
  attempt: number;
}

export interface WhatsAppSendEvent {
  /** Meta wamid returned in the send response (`messages[0].id`). */
  wamid: string;
  /** Send kind: 'text' | 'template' | 'interactive' | 'image' | 'document' | 'reaction' | 'flow' | string */
  kind: string;
  /** Recipient identifier — phone (E.164) or BSUID, whichever was used. */
  recipientId: string;
  /** Populated for `kind === 'template'` only. */
  templateName?: string;
  /**
   * Up-to-280-char preview for operator UIs. PII-light: text body
   * truncated; templates show the template name + first body param.
   */
  preview?: string;
}

const DEFAULT_API_URL = 'https://graph.facebook.com/v21.0';

function authHeaders(token: string, apiBaseUrl: string): Record<string, string> {
  return apiBaseUrl.includes('kapso.ai')
    ? { 'X-Api-Key': token }
    : { Authorization: `Bearer ${token}` };
}

export class WhatsAppClient {
  readonly phoneNumberId: string;
  readonly accessToken: string;
  readonly apiBaseUrl: string;
  private readonly onSent?: WhatsAppClientConfig['onSent'];
  private readonly onApiCall?: WhatsAppClientConfig['onApiCall'];

  constructor(config: WhatsAppClientConfig) {
    this.phoneNumberId = config.phoneNumberId;
    this.accessToken = config.accessToken;
    this.apiBaseUrl = config.apiBaseUrl ?? DEFAULT_API_URL;
    this.onSent = config.onSent;
    this.onApiCall = config.onApiCall;
  }

  /** Fire-and-forget audit hook for one request attempt. */
  private async fireApiCall(event: WhatsAppApiCallEvent): Promise<void> {
    if (!this.onApiCall) return;
    try {
      await this.onApiCall(event);
    } catch (err) {
      console.error('[whatsapp.client] api-call hook failed', {
        endpoint: event.endpoint,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Run the `onSent` hook fire-and-forget. We swallow exceptions here
   * — a downed audit log must NEVER fail an outbound send, since the
   * customer message has already been delivered to Meta.
   */
  private async fireAudit(event: WhatsAppSendEvent): Promise<void> {
    if (!this.onSent) return;
    try {
      await this.onSent(event);
    } catch (err) {
      console.error('[whatsapp.client] audit hook failed', {
        wamid: event.wamid,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Retries on transient failure: 5xx (Meta-side outages) and 429
   * (rate limit). 4xx errors bubble immediately — those are caller
   * bugs that retry won't fix (bad template id, malformed payload,
   * outside the 24h window, etc).
   *
   * Backoff: 200 / 400 / 800 ms with a small jitter. If Meta returns
   * `Retry-After` (RFC 7231) the header wins. Capped at 3 attempts
   * total — each `chat.postMessage`-equivalent send is on the
   * latency-sensitive webhook path, so we'd rather fail fast than hold
   * the dispatch budget hostage.
   */
  private async request(endpoint: string, body: unknown) {
    const url = `${this.apiBaseUrl}/${this.phoneNumberId}${endpoint}`;
    // Endpoint shape for audit (replaces `{phone_number_id}` so rows
    // aggregate cleanly across tenants). Caller's `endpoint` arg is
    // already in shape form (e.g. `/messages`, `/{mediaId}` is rare
    // here — request() is POST-only and called for /messages).
    const endpointShape = `/{phone_number_id}${endpoint}`;
    const headers = {
      ...authHeaders(this.accessToken, this.apiBaseUrl),
      'Content-Type': 'application/json',
    };
    const payload = JSON.stringify(body);

    const MAX_ATTEMPTS = 3;
    let lastError = '';
    let lastStatus = 0;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const start = Date.now();
      let response: Response;
      try {
        response = await fetch(url, { method: 'POST', headers, body: payload });
      } catch (err) {
        // Network / DNS / TLS failure — no HTTP response at all.
        const message = err instanceof Error ? err.message : String(err);
        await this.fireApiCall({
          method: 'POST',
          endpoint: endpointShape,
          statusCode: 0,
          durationMs: Date.now() - start,
          ok: false,
          errorMessage: message,
          attempt,
        });
        if (attempt === MAX_ATTEMPTS) {
          throw new Error(`WhatsApp API network error: ${message}`);
        }
        await new Promise(r => setTimeout(r, 200 * 2 ** (attempt - 1)));
        continue;
      }
      const durationMs = Date.now() - start;

      if (response.ok) {
        await this.fireApiCall({
          method: 'POST',
          endpoint: endpointShape,
          statusCode: response.status,
          durationMs,
          ok: true,
          attempt,
        });
        return response.json();
      }

      lastStatus = response.status;
      lastError = await response.text();
      await this.fireApiCall({
        method: 'POST',
        endpoint: endpointShape,
        statusCode: response.status,
        durationMs,
        ok: false,
        errorMessage: lastError,
        attempt,
      });

      const transient = response.status >= 500 || response.status === 429;
      if (!transient || attempt === MAX_ATTEMPTS) break;

      // Honor Retry-After when Meta provides it; otherwise exponential
      // backoff with jitter (200, 400, 800 ms ± 50ms).
      const retryAfterHeader = response.headers.get('retry-after');
      const retryAfterSec = retryAfterHeader ? Number(retryAfterHeader) : NaN;
      const delayMs =
        Number.isFinite(retryAfterSec) && retryAfterSec > 0
          ? retryAfterSec * 1000
          : 200 * 2 ** (attempt - 1) + Math.floor(Math.random() * 100);
      await new Promise(r => setTimeout(r, delayMs));
    }

    throw new Error(`WhatsApp API error: ${lastStatus} - ${lastError}`);
  }

  async sendText(to: string, text: string) {
    const result = await this.request('/messages', {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { body: text },
    });
    const wamid = extractWamid(result);
    if (wamid) {
      await this.fireAudit({
        wamid,
        kind: 'text',
        recipientId: to,
        preview: truncatePreview(text),
      });
    }
    return result;
  }

  /**
   * Send a pre-rendered Cloud API payload.
   *
   * The canonical channel-render layer in `apps/app/lib/channel-render`
   * emits a discriminated payload shape (text / interactive / image /
   * template). This method accepts that already-shaped envelope and
   * POSTs it to the Cloud API verbatim, so the canonical render path is
   * the single source of truth at the wire edge.
   *
   * The payload is typed as `unknown` here because the canonical
   * `WhatsAppPayload` interface lives in `apps/app/lib/channel-render`
   * and packages can not import from apps. The orchestrator at
   * `apps/app/lib/channel-send/whatsapp.ts` keeps the strict type and
   * casts at the package boundary; the contents are validated by the
   * Cloud API on receipt.
   *
   * Reference: https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages
   */
  async send(payload: unknown) {
    const result = await this.request('/messages', payload);
    const wamid = extractWamid(result);
    if (wamid) {
      const meta = inspectPayload(payload);
      await this.fireAudit({
        wamid,
        kind: meta.kind,
        recipientId: meta.recipientId,
        ...(meta.templateName ? { templateName: meta.templateName } : {}),
        ...(meta.preview ? { preview: meta.preview } : {}),
      });
    }
    return result;
  }

  async reactToMessage(to: string, messageId: string, emoji: string) {
    return this.request('/messages', {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'reaction',
      reaction: { message_id: messageId, emoji },
    });
  }

  async removeReaction(to: string, messageId: string) {
    return this.reactToMessage(to, messageId, '');
  }

  /**
   * Pre-approved HSM template (Meta-registered). Required for first-touch
   * messages outside the 24-hour customer service window.
   */
  async sendTemplate(args: {
    to: string;
    templateName: string;
    languageCode: string;
    components?: Array<{
      type: 'header' | 'body' | 'button';
      parameters: Array<{ type: 'text' | 'currency' | 'date_time'; text?: string }>;
      sub_type?: 'quick_reply' | 'url';
      index?: number;
    }>;
  }) {
    const result = await this.request('/messages', {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: args.to,
      type: 'template',
      template: {
        name: args.templateName,
        language: { code: args.languageCode },
        components: args.components ?? [],
      },
    });
    const wamid = extractWamid(result);
    if (wamid) {
      const firstBodyParam = args.components
        ?.find(c => c.type === 'body')
        ?.parameters?.find(p => p.type === 'text')?.text;
      await this.fireAudit({
        wamid,
        kind: 'template',
        recipientId: args.to,
        templateName: args.templateName,
        preview: firstBodyParam
          ? `${args.templateName}: ${truncatePreview(firstBodyParam)}`
          : args.templateName,
      });
    }
    return result;
  }

  async sendInteractiveButtons(
    to: string,
    body: string,
    buttons: Array<{ id: string; title: string }>
  ) {
    if (buttons.length > 3) {
      throw new Error('WhatsApp interactive messages allow a maximum of 3 buttons');
    }
    const result = await this.request('/messages', {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: body },
        action: {
          buttons: buttons.map(b => ({
            type: 'reply',
            reply: { id: b.id, title: b.title },
          })),
        },
      },
    });
    const wamid = extractWamid(result);
    if (wamid) {
      await this.fireAudit({
        wamid,
        kind: 'interactive',
        recipientId: to,
        preview: truncatePreview(body),
      });
    }
    return result;
  }

  async sendListMessage(
    to: string,
    body: string,
    buttonText: string,
    sections: Array<{
      title: string;
      rows: Array<{ id: string; title: string; description?: string }>;
    }>
  ) {
    if (sections.length > 10) {
      throw new Error('Maximum 10 sections allowed in list message');
    }
    for (const section of sections) {
      if (section.rows.length > 10) {
        throw new Error('Maximum 10 rows allowed per section');
      }
    }
    return this.request('/messages', {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: body },
        action: {
          button: buttonText,
          sections: sections.map(section => ({
            title: section.title,
            rows: section.rows.map(row => ({
              id: row.id,
              title: row.title,
              description: row.description,
            })),
          })),
        },
      },
    });
  }

  async getMediaUrl(mediaId: string): Promise<string> {
    const response = await fetch(`${this.apiBaseUrl}/${mediaId}`, {
      headers: authHeaders(this.accessToken, this.apiBaseUrl),
    });
    if (!response.ok) {
      throw new Error(`Failed to get media URL: ${response.status}`);
    }
    const data = (await response.json()) as { url: string };
    return data.url;
  }

  /** Two-step: resolve signed URL, then fetch the binary with the same auth header. */
  async downloadMedia(mediaId: string): Promise<ArrayBuffer> {
    const mediaUrl = await this.getMediaUrl(mediaId);
    const response = await fetch(mediaUrl, {
      headers: authHeaders(this.accessToken, this.apiBaseUrl),
    });
    if (!response.ok) {
      throw new Error(`Failed to download media: ${response.status}`);
    }
    return response.arrayBuffer();
  }

  /**
   * Upload media to Meta and return the `mediaId` that can be used in a
   * subsequent message-send (`image.id`, `document.id`, `video.id`).
   *
   * Required for outbound media that wasn't already hosted on a public
   * URL Meta could fetch — invoice PDFs, scan-document followups,
   * traveler-uploaded passport snapshots we re-emit, etc. Without this
   * the only path is to host the file ourselves and pass `link`, which
   * leaks our hostnames into Meta's CDN cache and won't work for
   * private files.
   *
   * Multipart shape per Meta spec:
   *   POST /{phone_number_id}/media
   *   form-data:
   *     - messaging_product=whatsapp
   *     - file=<binary>
   *     - type=<mime>
   *
   * Note: this does NOT go through `request()` because that helper
   * forces JSON. The Meta media endpoint requires multipart/form-data
   * with the binary attached as a `Blob`.
   */
  async uploadMedia(args: {
    /** Binary content (image / pdf / etc). */
    data: ArrayBuffer | Uint8Array;
    /** MIME type Meta will associate with the media (`image/jpeg`, etc). */
    mimeType: string;
    /** Optional filename — Meta surfaces it for documents. */
    filename?: string;
  }): Promise<{ mediaId: string }> {
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', args.mimeType);
    const bytes =
      args.data instanceof Uint8Array ? args.data : new Uint8Array(args.data as ArrayBuffer);
    form.append(
      'file',
      new Blob([bytes as unknown as BlobPart], { type: args.mimeType }),
      args.filename ?? 'upload'
    );

    const response = await fetch(`${this.apiBaseUrl}/${this.phoneNumberId}/media`, {
      method: 'POST',
      headers: authHeaders(this.accessToken, this.apiBaseUrl),
      body: form,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`WhatsApp media upload error: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as { id?: string };
    if (!data.id) throw new Error('WhatsApp media upload returned no id');
    return { mediaId: data.id };
  }
}

/**
 * Extract Meta's wamid from a send response. Meta returns
 * `messages: [{ id: 'wamid.X' }]` on success; older / proxied paths
 * may omit it. Returns null when absent so callers can skip the
 * audit hook gracefully.
 */
function extractWamid(response: unknown): string | null {
  if (!response || typeof response !== 'object') return null;
  const messages = (response as { messages?: unknown }).messages;
  if (!Array.isArray(messages) || messages.length === 0) return null;
  const first = messages[0];
  if (!first || typeof first !== 'object') return null;
  const id = (first as { id?: unknown }).id;
  return typeof id === 'string' ? id : null;
}

/**
 * Truncate user content to a 280-char preview for operator UIs.
 * Keeps the original case + whitespace; just clips and adds an
 * ellipsis when over the cap.
 */
function truncatePreview(text: string, max = 280): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

/**
 * Best-effort introspection for the canonical `send(payload)` path.
 * The payload could be any of the WhatsApp message shapes — we narrow
 * on `type` and pick out a sensible preview + recipient. Returns
 * defaults (kind='unknown', preview empty) when the shape is
 * unfamiliar so the audit row still records the wamid.
 */
function inspectPayload(payload: unknown): {
  kind: string;
  recipientId: string;
  templateName?: string;
  preview?: string;
} {
  if (!payload || typeof payload !== 'object') {
    return { kind: 'unknown', recipientId: '' };
  }
  const p = payload as {
    type?: string;
    to?: string;
    text?: { body?: string };
    template?: { name?: string };
    interactive?: { body?: { text?: string } };
    image?: { caption?: string };
    document?: { caption?: string };
  };
  const recipientId = typeof p.to === 'string' ? p.to : '';
  const kind = typeof p.type === 'string' ? p.type : 'unknown';
  if (kind === 'text' && p.text?.body) {
    return { kind, recipientId, preview: truncatePreview(p.text.body) };
  }
  if (kind === 'template' && p.template?.name) {
    return { kind, recipientId, templateName: p.template.name, preview: p.template.name };
  }
  if (kind === 'interactive' && p.interactive?.body?.text) {
    return { kind, recipientId, preview: truncatePreview(p.interactive.body.text) };
  }
  if ((kind === 'image' || kind === 'document') && p[kind]?.caption) {
    return { kind, recipientId, preview: truncatePreview(p[kind]!.caption!) };
  }
  return { kind, recipientId };
}

export const REACTION_EMOJIS = {
  PROCESSING: '\u23F3',
  SUCCESS: '\u2705',
  ERROR: '\u274C',
  BOOKED: '\u2708',
  APPROVED: '\uD83D\uDC4D',
  REJECTED: '\uD83D\uDC4E',
} as const;
