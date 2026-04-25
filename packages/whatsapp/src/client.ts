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

  constructor(config: WhatsAppClientConfig) {
    this.phoneNumberId = config.phoneNumberId;
    this.accessToken = config.accessToken;
    this.apiBaseUrl = config.apiBaseUrl ?? DEFAULT_API_URL;
  }

  private async request(endpoint: string, body: unknown) {
    const response = await fetch(`${this.apiBaseUrl}/${this.phoneNumberId}${endpoint}`, {
      method: 'POST',
      headers: {
        ...authHeaders(this.accessToken, this.apiBaseUrl),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`WhatsApp API error: ${response.status} - ${error}`);
    }

    return response.json();
  }

  async sendText(to: string, text: string) {
    return this.request('/messages', {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { body: text },
    });
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
    return this.request('/messages', payload);
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
    return this.request('/messages', {
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
  }

  async sendInteractiveButtons(
    to: string,
    body: string,
    buttons: Array<{ id: string; title: string }>
  ) {
    if (buttons.length > 3) {
      throw new Error('WhatsApp interactive messages allow a maximum of 3 buttons');
    }
    return this.request('/messages', {
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
}

export const REACTION_EMOJIS = {
  PROCESSING: '\u23F3',
  SUCCESS: '\u2705',
  ERROR: '\u274C',
  BOOKED: '\u2708',
  APPROVED: '\uD83D\uDC4D',
  REJECTED: '\uD83D\uDC4E',
} as const;
