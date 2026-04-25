/**
 * Kapso Platform API client.
 *
 * Thin typed wrapper around https://api.kapso.ai/platform/v1. Auth is a
 * single `X-API-Key` header. The client is fetch-based, pure function
 * calls — persistence, retries, and logging live in the calling route.
 *
 * The Meta-proxy layer (sending messages, media upload/download) still
 * lives in `@sendero/whatsapp` because its surface maps 1:1 to Meta's
 * Graph API. Kapso's Meta proxy accepts the same payloads, differing
 * only in the auth header (`X-Api-Key` vs `Authorization: Bearer`) —
 * that's already handled in the `@sendero/whatsapp` client.
 *
 * Ported from desk-v1, adapted for Sendero.
 */

import {
  CreateSetupLinkRequest,
  KapsoCustomer,
  KapsoSetupLink,
  KapsoWhatsAppPhoneNumber,
  SendTemplateRequest,
  SendTextRequest,
} from './types';

export interface KapsoClientConfig {
  /**
   * Host without trailing path. Defaults to the production Kapso host.
   * Override for staging (https://api.staging.kapso.ai).
   */
  baseUrl?: string;
  apiKey: string;
  /** Optional fetch override — lets tests inject a mock transport. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_BASE_URL = 'https://api.kapso.ai';
const PLATFORM_PATH = '/platform/v1';

export class KapsoError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.name = 'KapsoError';
    this.status = status;
    this.body = body;
  }
}

export class KapsoClient {
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: KapsoClientConfig) {
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${PLATFORM_PATH}${path}`;
    const response = await this.fetchImpl(url, {
      ...init,
      headers: {
        'X-API-Key': this.apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(init.headers ?? {}),
      },
    });

    const raw = await response.text();
    const parsed: unknown = raw ? safeJson(raw) : undefined;

    if (!response.ok) {
      throw new KapsoError(
        response.status,
        parsed,
        `Kapso ${init.method ?? 'GET'} ${path} failed: ${response.status}`
      );
    }
    return parsed as T;
  }

  // ── Customers ──────────────────────────────────────────────────────
  async createCustomer(args: {
    name: string;
    /** Sendero tenant id — Kapso indexes customers under this for lookup. */
    externalCustomerId?: string;
  }): Promise<KapsoCustomer> {
    const raw = await this.request<unknown>('/customers', {
      method: 'POST',
      body: JSON.stringify({
        customer: {
          name: args.name,
          external_customer_id: args.externalCustomerId,
        },
      }),
    });
    return KapsoCustomer.parse(unwrap(raw, 'customer') ?? unwrap(raw, 'data'));
  }

  /**
   * Find a Kapso customer by the Sendero tenant id we stamped on it.
   * Kapso enforces uniqueness on `external_customer_id`, so the first
   * match (if any) is the canonical one. Returns null when nothing is
   * found — callers can `findOrCreate`.
   */
  async findCustomerByExternalId(externalCustomerId: string): Promise<KapsoCustomer | null> {
    const raw = await this.request<unknown>(
      `/customers?external_customer_id=${encodeURIComponent(externalCustomerId)}`
    );
    const list = unwrap(raw, 'data') ?? unwrap(raw, 'customers') ?? raw;
    if (!Array.isArray(list) || list.length === 0) return null;
    return KapsoCustomer.parse(list[0]);
  }

  /**
   * Idempotent customer get-or-create. Avoids the 422
   * "External customer has already been taken" error when a prior partial
   * setup left a Kapso customer behind without a matching Sendero install
   * row.
   */
  async findOrCreateCustomer(args: {
    name: string;
    externalCustomerId: string;
  }): Promise<KapsoCustomer> {
    const existing = await this.findCustomerByExternalId(args.externalCustomerId);
    if (existing) return existing;
    return this.createCustomer(args);
  }

  async getCustomer(customerId: string): Promise<KapsoCustomer> {
    const raw = await this.request<unknown>(`/customers/${customerId}`);
    return KapsoCustomer.parse(unwrap(raw, 'customer') ?? unwrap(raw, 'data'));
  }

  // ── Setup links ────────────────────────────────────────────────────
  async createSetupLink(
    customerId: string,
    input: Partial<Parameters<typeof CreateSetupLinkRequest.parse>[0]> = {}
  ): Promise<KapsoSetupLink> {
    const body = CreateSetupLinkRequest.parse({
      allowed_connection_types: ['dedicated'],
      provision_phone_number: true,
      ...input,
    });
    const raw = await this.request<unknown>(`/customers/${customerId}/setup_links`, {
      method: 'POST',
      body: JSON.stringify({ setup_link: body }),
    });
    const unwrapped = unwrap(raw, 'data') ?? unwrap(raw, 'setup_link') ?? raw;
    // Kapso doesn't echo customer_id on this endpoint (it's in the URL).
    // Stitch it in so downstream consumers always see it.
    const stitched =
      typeof unwrapped === 'object' && unwrapped !== null
        ? { ...(unwrapped as object), customer_id: customerId }
        : unwrapped;
    return KapsoSetupLink.parse(stitched);
  }

  async getSetupLink(setupLinkId: string): Promise<KapsoSetupLink> {
    const raw = await this.request<unknown>(`/setup_links/${setupLinkId}`);
    return KapsoSetupLink.parse(unwrap(raw, 'data') ?? unwrap(raw, 'setup_link'));
  }

  // ── WhatsApp phone numbers ────────────────────────────────────────
  async listPhoneNumbersForCustomer(customerId: string): Promise<KapsoWhatsAppPhoneNumber[]> {
    const raw = await this.request<unknown>(
      `/whatsapp/phone_numbers?customer_id=${encodeURIComponent(customerId)}`
    );
    const list = unwrap(raw, 'phone_numbers') ?? unwrap(raw, 'data') ?? raw;
    if (!Array.isArray(list)) return [];
    return list.map(item => KapsoWhatsAppPhoneNumber.parse(item));
  }

  async getPhoneNumber(phoneNumberId: string): Promise<KapsoWhatsAppPhoneNumber> {
    const raw = await this.request<unknown>(`/whatsapp/phone_numbers/${phoneNumberId}`);
    return KapsoWhatsAppPhoneNumber.parse(unwrap(raw, 'phone_number'));
  }

  // ── Webhooks ──────────────────────────────────────────────────────
  //
  // Project-scope webhooks (the kind Sendero needs for
  // `whatsapp.phone_number.created`) are dashboard-only on Kapso —
  // verified Apr 2026 against
  // https://docs.kapso.ai/docs/platform/webhooks/overview. Register
  // via the Kapso dashboard, paste the secret into KAPSO_WEBHOOK_SECRET,
  // and use `bun scripts/register-kapso-webhook.ts` to print the steps.
  //
  // WhatsApp number-scoped webhooks DO have an API surface
  // (POST /platform/v1/whatsapp/phone_numbers/:id/webhooks) — wire
  // those here when we need per-number webhook control. We don't need
  // them today: connection events come through the project-scope
  // webhook, and inbound messages flow through Meta → Kapso proxy
  // → /api/webhooks/whatsapp.

  // ── Outbound messages (Kapso's higher-level send helper) ──────────
  /**
   * Kapso also exposes a typed /whatsapp/messages endpoint that mirrors
   * Meta's Graph API. Useful when the caller doesn't want to manage the
   * Meta envelope directly. For Sendero we prefer the @sendero/whatsapp
   * client (it sends straight to Meta via Kapso's proxy) and reserve
   * this helper for scenarios where we need Kapso-side bookkeeping.
   */
  async sendText(input: Parameters<typeof SendTextRequest.parse>[0]): Promise<{ id: string }> {
    const body = SendTextRequest.parse(input);
    const raw = await this.request<unknown>('/whatsapp/messages', {
      method: 'POST',
      body: JSON.stringify({ message: body }),
    });
    const parsed = unwrap(raw, 'message') as { id?: string } | undefined;
    if (!parsed?.id) throw new KapsoError(500, raw, 'Kapso sendText: missing message.id');
    return { id: parsed.id };
  }

  async sendTemplate(
    input: Parameters<typeof SendTemplateRequest.parse>[0]
  ): Promise<{ id: string }> {
    const body = SendTemplateRequest.parse(input);
    const raw = await this.request<unknown>('/whatsapp/messages/template', {
      method: 'POST',
      body: JSON.stringify({ message: body }),
    });
    const parsed = unwrap(raw, 'message') as { id?: string } | undefined;
    if (!parsed?.id) throw new KapsoError(500, raw, 'Kapso sendTemplate: missing message.id');
    return { id: parsed.id };
  }

  /** Health ping — Platform API status. 200 when project API key is valid. */
  async ping(): Promise<{ ok: true }> {
    await this.request<unknown>('/status');
    return { ok: true };
  }
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * Kapso wraps most resource responses as `{ resource: {...} }`. Tolerate
 * both wrapped and bare shapes so we don't break if Kapso drops the
 * wrapper for some endpoints.
 */
function unwrap(body: unknown, key: string): unknown {
  if (body && typeof body === 'object' && key in body) {
    return (body as Record<string, unknown>)[key];
  }
  return undefined;
}
