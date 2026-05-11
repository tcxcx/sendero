/**
 * Single source of truth for resolving a trip's origin + destination
 * country (ISO-3166 alpha-2) from whatever input shape is available —
 * Duffel-projected segments, free-form trip intent, or a stay
 * confirmation payload.
 *
 * Why one helper: the map UI in `apps/app/app/(app)/dashboard/trips/map/page.tsx`
 * and the intent enricher both need country resolution; without a shared
 * helper, the resolution chain drifts and "Trips needing route metadata"
 * surfaces real-but-recoverable rows.
 *
 * Resolution order, per channel:
 *   1. Explicit `originCountry` / `destinationCountry` field (any
 *      common naming — see ALIASES below).
 *   2. IATA fallback via `iataToCountryAlpha2` from `@sendero/duffel`.
 *   3. Return null + `source: 'none'` so the caller can decide whether
 *      to ask the agent or report a knowledge gap.
 *
 * The helper NEVER guesses from city name alone — too ambiguous
 * ("Springfield" exists in 30+ countries). Use IATA when present;
 * otherwise return null and let the agent ask.
 */

import { iataToCountryAlpha2 } from '@sendero/duffel/country-from-iata';

/** Result of derivation. `source` lets callers log how confident the
 *  resolution was — segment > iata-lookup > intent > none. */
export interface DerivedRouteCountries {
  originCountry: string | null;
  destinationCountry: string | null;
  /** Where the origin came from. Same union as `destinationSource`. */
  originSource: RouteCountrySource;
  /** Where the destination came from. */
  destinationSource: RouteCountrySource;
}

export type RouteCountrySource =
  | 'segment-explicit'
  | 'segment-iata-fallback'
  | 'intent-explicit'
  | 'intent-iata-fallback'
  | 'stay-explicit'
  | 'none';

/** Common field-name aliases for an origin country across our segment
 *  shapes (Duffel-projected, raw Duffel, manually-built). */
const ORIGIN_COUNTRY_ALIASES = [
  'originCountry',
  'originIso2',
  'origin_country',
  'origin_country_code',
  'originIataCountryCode',
  'origin_iata_country_code',
] as const;

const DESTINATION_COUNTRY_ALIASES = [
  'destinationCountry',
  'destinationIso2',
  'destination_country',
  'destination_country_code',
  'destinationIataCountryCode',
  'destination_iata_country_code',
  'arrivalCountry',
  'arrival_country_code',
] as const;

const ORIGIN_IATA_ALIASES = [
  'originIata',
  'originIATA',
  'origin_iata',
  'originIataCode',
  'originCode',
  'origin_code',
] as const;

const DESTINATION_IATA_ALIASES = [
  'destinationIata',
  'destinationIATA',
  'destination_iata',
  'destinationIataCode',
  'destinationCode',
  'destination_code',
  'arrivalIata',
  'arrival_iata',
] as const;

function pickStr(obj: unknown, keys: readonly string[]): string | null {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const o = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

function normalizeIso2(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(trimmed) ? trimmed : null;
}

/**
 * Derive countries from a single flight segment. Used for both
 * Booking.segments rows (Duffel-projected) and one-off ad-hoc
 * persistence paths.
 */
export function deriveCountriesFromSegment(segment: unknown): DerivedRouteCountries {
  const explicitOrigin = normalizeIso2(pickStr(segment, ORIGIN_COUNTRY_ALIASES));
  const explicitDest = normalizeIso2(pickStr(segment, DESTINATION_COUNTRY_ALIASES));

  let originCountry = explicitOrigin;
  let originSource: RouteCountrySource = explicitOrigin ? 'segment-explicit' : 'none';
  if (!originCountry) {
    const iata = pickStr(segment, ORIGIN_IATA_ALIASES);
    const fallback = iataToCountryAlpha2(iata);
    if (fallback) {
      originCountry = fallback;
      originSource = 'segment-iata-fallback';
    }
  }

  let destinationCountry = explicitDest;
  let destinationSource: RouteCountrySource = explicitDest ? 'segment-explicit' : 'none';
  if (!destinationCountry) {
    const iata = pickStr(segment, DESTINATION_IATA_ALIASES);
    const fallback = iataToCountryAlpha2(iata);
    if (fallback) {
      destinationCountry = fallback;
      destinationSource = 'segment-iata-fallback';
    }
  }

  return { originCountry, destinationCountry, originSource, destinationSource };
}

/**
 * Derive from `Trip.intent`. Intent fields can be either an IATA code
 * (e.g. "SFO") or free-form ("San Francisco" / "Tokyo"). We only resolve
 * when the input is an unambiguous IATA — free-form names go to the
 * agent for clarification rather than guessing.
 */
export function deriveCountriesFromIntent(intent: unknown): DerivedRouteCountries {
  const explicitOrigin = normalizeIso2(pickStr(intent, ORIGIN_COUNTRY_ALIASES));
  const explicitDest = normalizeIso2(pickStr(intent, DESTINATION_COUNTRY_ALIASES));

  // Free-form intent fields can hold an IATA code under `origin` /
  // `destination`. Try the IATA fallback when explicit country is
  // absent and the value matches the IATA shape.
  const tryIata = (raw: string | null): string | null => {
    if (!raw) return null;
    return iataToCountryAlpha2(raw);
  };

  let originCountry = explicitOrigin;
  let originSource: RouteCountrySource = explicitOrigin ? 'intent-explicit' : 'none';
  if (!originCountry) {
    const fallback = tryIata(pickStr(intent, ['origin', ...ORIGIN_IATA_ALIASES]));
    if (fallback) {
      originCountry = fallback;
      originSource = 'intent-iata-fallback';
    }
  }

  let destinationCountry = explicitDest;
  let destinationSource: RouteCountrySource = explicitDest ? 'intent-explicit' : 'none';
  if (!destinationCountry) {
    const fallback = tryIata(pickStr(intent, ['destination', ...DESTINATION_IATA_ALIASES]));
    if (fallback) {
      destinationCountry = fallback;
      destinationSource = 'intent-iata-fallback';
    }
  }

  return { originCountry, destinationCountry, originSource, destinationSource };
}

/**
 * Derive from a stay-booking confirmation. Stays have no "origin" by
 * nature — only the accommodation's country (the destination). Origin
 * is left null; callers compose with their flight segment(s) when both
 * exist on a trip.
 */
export function deriveCountriesFromStay(stay: unknown): DerivedRouteCountries {
  const explicit = normalizeIso2(
    pickStr(stay, ['country', 'countryCode', 'country_code', 'destinationCountry'])
  );
  return {
    originCountry: null,
    originSource: 'none',
    destinationCountry: explicit,
    destinationSource: explicit ? 'stay-explicit' : 'none',
  };
}

/**
 * Derive countries for an entire trip — segments + intent + stay
 * fallbacks combined. Use this from the persistence path for
 * `Trip.intent` enrichment and from the backfill script.
 *
 * Resolution priority:
 *   - First segment with a resolvable origin/destination wins.
 *   - Then intent.
 *   - Then stay (destination only).
 */
export function deriveRouteCountries(args: {
  segments?: ReadonlyArray<unknown>;
  intent?: unknown;
  stay?: unknown;
}): DerivedRouteCountries {
  let originCountry: string | null = null;
  let destinationCountry: string | null = null;
  let originSource: RouteCountrySource = 'none';
  let destinationSource: RouteCountrySource = 'none';

  for (const seg of args.segments ?? []) {
    const fromSeg = deriveCountriesFromSegment(seg);
    if (!originCountry && fromSeg.originCountry) {
      originCountry = fromSeg.originCountry;
      originSource = fromSeg.originSource;
    }
    // For destination, prefer the FIRST segment whose destination
    // differs from origin — handles round-trips where the last
    // segment's destination equals the origin country.
    if (!destinationCountry && fromSeg.destinationCountry) {
      if (
        !originCountry ||
        fromSeg.destinationCountry.toUpperCase() !== originCountry.toUpperCase()
      ) {
        destinationCountry = fromSeg.destinationCountry;
        destinationSource = fromSeg.destinationSource;
      }
    }
    if (originCountry && destinationCountry) break;
  }

  // Fallback: round-trip with a single domestic-shaped segment.
  if (!destinationCountry) {
    const lastSeg = args.segments?.[args.segments.length - 1];
    if (lastSeg) {
      const last = deriveCountriesFromSegment(lastSeg);
      if (last.destinationCountry) {
        destinationCountry = last.destinationCountry;
        destinationSource = last.destinationSource;
      }
    }
  }

  if (!originCountry || !destinationCountry) {
    const fromIntent = deriveCountriesFromIntent(args.intent);
    if (!originCountry && fromIntent.originCountry) {
      originCountry = fromIntent.originCountry;
      originSource = fromIntent.originSource;
    }
    if (!destinationCountry && fromIntent.destinationCountry) {
      destinationCountry = fromIntent.destinationCountry;
      destinationSource = fromIntent.destinationSource;
    }
  }

  if (!destinationCountry) {
    const fromStay = deriveCountriesFromStay(args.stay);
    if (fromStay.destinationCountry) {
      destinationCountry = fromStay.destinationCountry;
      destinationSource = fromStay.destinationSource;
    }
  }

  return { originCountry, destinationCountry, originSource, destinationSource };
}
