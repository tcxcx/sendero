/**
 * Minimal Sherpa Requirements API v3 type sketch.
 *
 * Sherpa's public docs show `POST /v3/trips` with a JSON:API body
 * (`application/vnd.api+json`) and `include=restriction,procedure` to
 * hydrate visa/eVisa/eTA options in a single round-trip.  Full OpenAPI
 * lives behind their request-access gate; we're modeling only the
 * fields we actually consume so the type surface stays stable across
 * doc revisions.
 *
 * Field names mirror Sherpa's JSON:API conventions (kebab-case in wire
 * format, camelCase in TypeScript — we translate on the boundary).
 */

/** One leg of the travel: origin or destination airport/country. */
export interface TripNode {
  /** IATA airport code (e.g. "EZE", "FRA") or ISO-2 country. */
  code: string;
  /** 'airport' | 'country' — controls how Sherpa scopes requirements. */
  type: 'airport' | 'country';
  /** YYYY-MM-DD for the date we're at this node. */
  date: string;
  /** 'origin' | 'destination' | 'via' (connecting airport). */
  role: 'origin' | 'destination' | 'via';
}

export interface TripTraveler {
  /** 2- or 3-letter ISO code for the passport the traveler will use. */
  nationalityIso: string;
  /** YYYY-MM-DD; optional at search time, required for purchase. */
  passportExpiry?: string;
  /** Optional — Sherpa personalizes visa eligibility on residency. */
  residencyIso?: string;
}

export interface TripsRequest {
  nodes: TripNode[];
  travelers: TripTraveler[];
  purpose: 'business' | 'leisure' | 'transit' | 'study' | 'medical';
  /** BCP-47, e.g. "en-US", "es-AR", "pt-BR". */
  locale?: string;
  currency?: string;
}

/**
 * One requirement entry Sherpa returns, translated to our shape.
 * Sherpa's `restriction-category` values include `VISA`, `ETA`,
 * `VACCINATION`, `DOCUMENT`, `CUSTOMS`, etc. — we normalize to the
 * subset Sendero actually renders.
 */
export interface SherpaRequirement {
  /** Our normalized code; agent-safe. */
  kind:
    | 'visa_required'
    | 'visa_free'
    | 'visa_on_arrival'
    | 'eta_required'
    | 'evisa_required'
    | 'passport_validity'
    | 'vaccination_required'
    | 'document_required'
    | 'customs_declaration'
    | 'other';
  /** Short machine-readable code.  UI renders its own copy from a
   *  translation table — we never show Sherpa prose directly. */
  code: string;
  /** Whether this requirement blocks the trip if unsatisfied. */
  blocking: boolean;
  /** Optional eVisa/eTA product reference when Sherpa offers one for
   *  purchase — unlocks the visa-ancillary CTA in the booking flow. */
  ancillary?: {
    productId: string;
    /** e.g. "visa_apply", "eta_apply" — the purchase endpoint type. */
    productKind: 'visa_apply' | 'eta_apply' | 'evisa_apply';
    /** Minor-unit price (cents) + ISO-4217 currency. Null when quote
     *  requires the traveler's full profile server-side. */
    priceMinor: number | null;
    currency: string | null;
    /** Human label for the product.  Still "safe" — no traveler PII. */
    label: string;
    /** Deeplink into Sherpa's co-branded apply flow for manual use. */
    applyUrl: string | null;
  } | null;
}

export interface TripsResponse {
  /** Sherpa's canonical identifier for this trip query. */
  sherpaTripId: string;
  requirements: SherpaRequirement[];
  /** Copy of the raw JSON:API body for replay + audit. */
  raw: unknown;
}
