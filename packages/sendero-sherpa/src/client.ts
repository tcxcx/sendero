/**
 * Sherpa Requirements + eVisa API client.
 *
 * Shape per Sherpa's public docs:
 *   POST https://api.joinsherpa.com/v3/trips
 *   Content-Type: application/vnd.api+json
 *   x-api-key: ${SHERPA_API_KEY}
 *   ?include=restriction,procedure
 *
 *   Sandbox: https://api-sandbox.joinsherpa.com (free tier, 1000 req/h)
 *   Production: plan-dependent rate limit
 *
 * The client is *graceful by design* — every call path returns
 * `{ ok: true, data } | { ok: false, reason }` so callers can trigger
 * the local curated-JSON fallback without throwing.  Sherpa outages,
 * expired keys, rate limits, network blips, and missing config are all
 * **non-halting**: we log the reason, mark the eligibility run
 * `source='fallback_rules'`, and keep the booking flow moving.
 *
 * Env contract:
 *   SHERPA_API_KEY          — required to call Sherpa; absent = fallback
 *   SHERPA_API_BASE_URL     — optional override; defaults to sandbox
 *                             unless NODE_ENV==='production'
 *   SHERPA_API_TIMEOUT_MS   — optional per-call deadline (default 4500ms)
 *
 * No retries inside this module — the eligibility-run worker is the
 * retry boundary, and retry policy is per-trigger (agent, UI, webhook).
 */

import type { TripsRequest, TripsResponse, SherpaRequirement } from './types';

export interface SherpaConfig {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
}

export type SherpaResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      reason: 'no_key' | 'timeout' | 'network' | 'http_error' | 'parse_error';
      message: string;
    };

export function resolveSherpaConfig(): SherpaConfig | null {
  const apiKey = process.env.SHERPA_API_KEY;
  if (!apiKey) return null;
  const baseUrl =
    process.env.SHERPA_API_BASE_URL ??
    (process.env.NODE_ENV === 'production'
      ? 'https://api.joinsherpa.com'
      : 'https://api-sandbox.joinsherpa.com');
  const timeoutMs = Number.parseInt(process.env.SHERPA_API_TIMEOUT_MS ?? '4500', 10);
  return {
    apiKey,
    baseUrl,
    timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 4500,
  };
}

/**
 * Hit `POST /v3/trips?include=restriction,procedure` with a JSON:API
 * body and normalize the response into our shape.  On any failure
 * we return `{ ok: false, reason }` — caller falls back to curated
 * rules.
 */
export async function postTrips(
  req: TripsRequest,
  cfg: SherpaConfig = resolveSherpaConfig()!,
  signal?: AbortSignal
): Promise<SherpaResult<TripsResponse>> {
  if (!cfg) return { ok: false, reason: 'no_key', message: 'SHERPA_API_KEY not set' };

  const url = `${cfg.baseUrl}/v3/trips?include=restriction,procedure`;
  const body = buildJsonApiTripBody(req);

  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), cfg.timeoutMs);
  if (signal) {
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'x-api-key': cfg.apiKey,
        'content-type': 'application/vnd.api+json',
        accept: 'application/vnd.api+json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(deadline);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        ok: false,
        reason: 'http_error',
        message: `sherpa ${res.status}: ${text.slice(0, 240)}`,
      };
    }

    const json = await res.json().catch(() => null);
    if (!json || typeof json !== 'object') {
      return { ok: false, reason: 'parse_error', message: 'sherpa returned non-JSON body' };
    }
    return { ok: true, data: normalizeTripsResponse(json as Record<string, unknown>) };
  } catch (err) {
    clearTimeout(deadline);
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { ok: false, reason: 'timeout', message: `sherpa call exceeded ${cfg.timeoutMs}ms` };
    }
    return {
      ok: false,
      reason: 'network',
      message: err instanceof Error ? err.message : 'unknown network error',
    };
  }
}

/**
 * JSON:API request body builder.  Sherpa expects a `data.attributes`
 * envelope with travelers + nodes.  We don't use relationships — the
 * `include` query param returns everything we need inline.
 */
function buildJsonApiTripBody(req: TripsRequest): Record<string, unknown> {
  return {
    data: {
      type: 'trip',
      attributes: {
        locale: req.locale ?? 'en-US',
        currency: req.currency ?? 'USD',
        purpose: req.purpose,
        travelers: req.travelers.map(t => ({
          nationality: t.nationalityIso.toUpperCase(),
          ...(t.passportExpiry ? { 'passport-expiration-date': t.passportExpiry } : {}),
          ...(t.residencyIso ? { residency: t.residencyIso.toUpperCase() } : {}),
        })),
        nodes: req.nodes.map(n => ({
          type: n.type,
          code: n.code.toUpperCase(),
          date: n.date,
          role: n.role,
        })),
      },
    },
  };
}

/**
 * Sherpa's JSON:API response rolls `included` alongside `data`.  We
 * flatten restrictions + procedures into a single `requirements` array
 * and cherry-pick the fields we care about.  The raw body is preserved
 * on `raw` for audit replay.
 *
 * This is intentionally lenient — unknown restriction categories
 * degrade to `kind: 'other'` rather than crashing, so a Sherpa schema
 * change doesn't knock the booking flow offline.
 */
function normalizeTripsResponse(json: Record<string, unknown>): TripsResponse {
  const data = (json.data ?? {}) as Record<string, unknown>;
  const attrs = (data.attributes ?? {}) as Record<string, unknown>;
  const included = Array.isArray(json.included)
    ? (json.included as Array<Record<string, unknown>>)
    : [];

  const requirements: SherpaRequirement[] = included
    .map(entry => mapIncludedToRequirement(entry))
    .filter((r): r is SherpaRequirement => r !== null);

  const sherpaTripId =
    typeof data.id === 'string'
      ? data.id
      : typeof attrs['trip-id'] === 'string'
        ? (attrs['trip-id'] as string)
        : 'unknown';

  return {
    sherpaTripId,
    requirements,
    raw: json,
  };
}

function mapIncludedToRequirement(entry: Record<string, unknown>): SherpaRequirement | null {
  const type = typeof entry.type === 'string' ? entry.type : null;
  const attrs = (entry.attributes ?? {}) as Record<string, unknown>;
  const category =
    typeof attrs['restriction-category'] === 'string'
      ? (attrs['restriction-category'] as string)
      : null;
  const code =
    typeof attrs.code === 'string'
      ? attrs.code
      : typeof attrs.slug === 'string'
        ? (attrs.slug as string)
        : (type ?? 'unknown');
  const blocking = attrs.blocking === true || attrs['is-blocking'] === true;

  const kind: SherpaRequirement['kind'] = (() => {
    switch ((category ?? '').toUpperCase()) {
      case 'VISA':
        return blocking ? 'visa_required' : 'visa_free';
      case 'ETA':
      case 'ELECTRONIC_TRAVEL_AUTHORIZATION':
        return 'eta_required';
      case 'EVISA':
        return 'evisa_required';
      case 'PASSPORT':
      case 'PASSPORT_VALIDITY':
        return 'passport_validity';
      case 'VACCINATION':
        return 'vaccination_required';
      case 'DOCUMENT':
        return 'document_required';
      case 'CUSTOMS':
        return 'customs_declaration';
      default:
        return 'other';
    }
  })();

  const procedure = (attrs.procedure ?? null) as Record<string, unknown> | null;
  const ancillary = procedure ? mapProcedureToAncillary(procedure) : null;

  return { kind, code, blocking, ancillary };
}

function mapProcedureToAncillary(proc: Record<string, unknown>): SherpaRequirement['ancillary'] {
  const productId = typeof proc.id === 'string' ? proc.id : null;
  if (!productId) return null;
  const label =
    typeof proc.name === 'string'
      ? proc.name
      : typeof proc.title === 'string'
        ? (proc.title as string)
        : 'Apply';
  const applyUrl = typeof proc['apply-url'] === 'string' ? (proc['apply-url'] as string) : null;
  const price = proc.price as { amount?: number; currency?: string } | undefined;
  const kind = typeof proc.kind === 'string' ? proc.kind : 'visa_apply';
  const productKind: 'visa_apply' | 'eta_apply' | 'evisa_apply' =
    kind === 'eta_apply' || kind === 'evisa_apply' ? kind : 'visa_apply';
  return {
    productId,
    productKind,
    priceMinor: typeof price?.amount === 'number' ? price.amount : null,
    currency: typeof price?.currency === 'string' ? price.currency : null,
    label,
    applyUrl,
  };
}
