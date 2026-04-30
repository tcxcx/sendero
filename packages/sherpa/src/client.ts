/**
 * Sherpa Requirements API v3 — REST client.
 *
 * Wire spec (vendored at openapi/sherpa-requirements-api-v3.json):
 *
 *   POST https://requirements-api.joinsherpa.com/v3/trips
 *   ?include=restriction,procedure[&utm_source=…&utm_medium=…&…]
 *   x-api-key: ${SHERPA_API_KEY}
 *   content-type: application/vnd.api+json
 *   accept:       application/vnd.api+json
 *
 *   body: { data: { type: 'TRIP', attributes: { travelNodes, traveller,
 *          locale, currency } } }
 *
 * Graceful by design: every failure mode returns
 * `{ ok: false, reason, message }`.  Callers (the eligibility-run
 * orchestrator) degrade to the curated corridor table in
 * `@sendero/vault/visa-rules` and keep the booking flow moving.  No
 * retries inside this module — retry policy belongs to the caller.
 *
 * Env:
 *   SHERPA_API_KEY          — present = call Sherpa; absent = fallback
 *   SHERPA_API_BASE_URL     — override (default `requirements-api.joinsherpa.com`
 *                             on prod, sandbox on dev)
 *   SHERPA_API_TIMEOUT_MS   — per-call deadline (default 4500ms)
 */

import type {
  Action,
  AncillaryProduct,
  InformationCategoryGroup,
  NormalizedRequirement,
  Price,
  Product,
  ProcedureEntity,
  RestrictionEntity,
  TripIncludedEntity,
  TripRequest,
  TripRequestAttributes,
  TripResponse,
  TripsResponseNormalized,
  UtmParams,
} from './types';

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

const DEFAULT_PROD_URL = 'https://requirements-api.joinsherpa.com';
/**
 * Sherpa doesn't publish a separate sandbox host for the Requirements
 * API — the dev/test env is granted against the same host via an
 * API-key tier.  We keep the env override so projects can point at a
 * mock for tests without editing code.
 */
const DEFAULT_DEV_URL = 'https://requirements-api.joinsherpa.com';

export function resolveSherpaConfig(): SherpaConfig | null {
  const apiKey = process.env.SHERPA_API_KEY;
  if (!apiKey) return null;
  const baseUrl =
    process.env.SHERPA_API_BASE_URL ??
    (process.env.NODE_ENV === 'production' ? DEFAULT_PROD_URL : DEFAULT_DEV_URL);
  const timeoutMs = Number.parseInt(process.env.SHERPA_API_TIMEOUT_MS ?? '4500', 10);
  return {
    apiKey,
    baseUrl,
    timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 4500,
  };
}

export interface PostTripsArgs {
  attributes: TripRequestAttributes;
  /** Forwarded as ?utm_source=…&utm_medium=… — merged onto redirect.url
   *  server-side for attribution on "See details" clicks. */
  utm?: UtmParams;
  /** Overrides the default `restriction,procedure` include set. */
  include?: string[];
  signal?: AbortSignal;
  config?: SherpaConfig;
}

/**
 * POST /v3/trips.  Returns normalized + raw.
 */
export async function postTrips(
  args: PostTripsArgs
): Promise<SherpaResult<TripsResponseNormalized>> {
  const cfg = args.config ?? resolveSherpaConfig();
  if (!cfg) return { ok: false, reason: 'no_key', message: 'SHERPA_API_KEY not set' };

  const includeParam = (args.include ?? ['restriction', 'procedure']).join(',');
  const qs = new URLSearchParams({ include: includeParam });
  if (args.utm) {
    for (const [k, v] of Object.entries(args.utm)) {
      if (v) qs.set(k, v);
    }
  }
  const url = `${cfg.baseUrl}/v3/trips?${qs.toString()}`;

  const body: TripRequest = {
    data: {
      type: 'TRIP',
      attributes: args.attributes,
    },
  };

  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), cfg.timeoutMs);
  if (args.signal) {
    args.signal.addEventListener('abort', () => controller.abort(), { once: true });
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

    const json = (await res.json().catch(() => null)) as TripResponse | null;
    if (!json || typeof json !== 'object' || !json.data) {
      return { ok: false, reason: 'parse_error', message: 'sherpa returned non-JSON body' };
    }
    return { ok: true, data: normalizeTripsResponse(json) };
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
 * Fold Sherpa's JSON:API response into the flat NormalizedRequirement[]
 * Sendero consumes. We inspect `included[]` for PROCEDURE + RESTRICTION
 * entities and cherry-pick the fields the booking UI + agent tools use.
 *
 * Unknown categories degrade to `kind: 'other'`, never throw.  A Sherpa
 * schema change doesn't knock the booking flow offline — it just means
 * the agent sees one extra `other` requirement it doesn't know how to
 * render, and the UI falls back to the category headline.
 */
export function normalizeTripsResponse(json: TripResponse): TripsResponseNormalized {
  const included: TripIncludedEntity[] = Array.isArray(json.included) ? json.included : [];
  const requirements: NormalizedRequirement[] = [];

  for (const entry of included) {
    if (entry.type === 'PROCEDURE') {
      const next = normalizeProcedure(entry);
      if (next) requirements.push(next);
    } else if (entry.type === 'RESTRICTION') {
      const next = normalizeRestriction(entry);
      if (next) requirements.push(next);
    }
  }

  const attrs = json.data.attributes ?? {};
  return {
    sherpaTripId: json.data.id,
    requirements,
    tripRedirect: attrs.redirect ?? null,
    categories: Array.isArray(attrs.categories) ? attrs.categories : [],
    alerts: Array.isArray(attrs.alerts) ? attrs.alerts : [],
    raw: json,
  };
}

function normalizeProcedure(entry: ProcedureEntity): NormalizedRequirement | null {
  const a = entry.attributes;
  const kind = classifyProcedureKind(a.category, a.documentTypes ?? []);
  const blocking = a.enforcement === 'MANDATORY';
  const ancillary = findPurchasableAncillary(a.actions ?? []);
  return {
    kind,
    code: `${a.category}:${a.subCategory}`,
    blocking,
    location: a.location ?? null,
    entityId: entry.id,
    ancillary,
  };
}

function normalizeRestriction(entry: RestrictionEntity): NormalizedRequirement | null {
  const a = entry.attributes;
  const blocking = a.enforcement === 'MANDATORY';
  const ancillary = findPurchasableAncillary(a.actions ?? []);
  return {
    kind: 'travel_restriction',
    code: a.category,
    blocking,
    location: a.location ?? null,
    entityId: entry.id,
    ancillary,
  };
}

/** Map the SPEC'd procedure category + document types into our coarse kind. */
function classifyProcedureKind(
  category: ProcedureEntity['attributes']['category'],
  documentTypes: string[]
): NormalizedRequirement['kind'] {
  const docs = new Set(documentTypes);
  if (docs.has('ETA')) return 'eta_required';
  if (docs.has('E_VISA')) return 'evisa_required';
  if (docs.has('VISA') || docs.has('EMBASSY_VISA') || docs.has('PAPER_VISA')) {
    return 'visa_required';
  }
  if (docs.has('PASSPORT')) return 'passport_validity';
  if (category === 'COVID_19_TEST') return 'document_required';
  if (category === 'QUARANTINE' || category === 'HEALTH_MEASURES') {
    return 'vaccination_required';
  }
  if (category === 'DOC_REQUIREMENT' || category === 'DOC_REQUIRED') {
    return 'document_required';
  }
  return 'other';
}

/**
 * Walk the `actions[]` array and find the first `apply-product` intent.
 * That's the one that unlocks the in-booking visa-add-on CTA — Sherpa
 * bundles a full Product shape (price, priceBreakdown, deadline) right
 * there on the action.
 */
function findPurchasableAncillary(actions: Action[]): AncillaryProduct | null {
  const apply = actions.find(a => a.intent === 'apply-product' && a.product);
  if (!apply || !apply.product) return null;
  const product: Product = apply.product;
  const productKind: AncillaryProduct['productKind'] = classifyProductKind(product.productId);
  return {
    productId: product.productId,
    productKind,
    label: product.name,
    priceMinor: priceToMinor(product.price),
    currency: product.price?.currency ?? null,
    applyUrl: apply.url,
    applicationDeadline: product.times?.applicationDeadline
      ? {
          type: product.times.applicationDeadline.type,
          value: product.times.applicationDeadline.value,
        }
      : null,
    priceBreakdown: product.priceBreakdown ?? [],
  };
}

function classifyProductKind(productId: string): AncillaryProduct['productKind'] {
  const id = productId.toUpperCase();
  if (id.endsWith('_ETA') || id.includes('ESTA')) return 'eta_apply';
  if (id.includes('EVISA') || id.includes('E_VISA')) return 'evisa_apply';
  if (id.includes('VISA')) return 'visa_apply';
  return 'other';
}

/** Sherpa prices are decimal value + currency ("41", "USD").  Minor is cents. */
function priceToMinor(price: Price | undefined): number | null {
  if (!price || typeof price.value !== 'number') return null;
  return Math.round(price.value * 100);
}
