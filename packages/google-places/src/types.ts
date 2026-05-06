/**
 * @sendero/google-places/types — public type surface.
 *
 * Mirrors the subset of Google Places API (New) we actually use across
 * Sendero anticipation tools. Stays minimal — every field has cost
 * (Places billing is per-field-mask), so we only ask for what every
 * downstream tool needs.
 */

/** Generic Place shape returned by both searchText + getPlace. */
export interface PlacesPlace {
  /** Stable Google place id (e.g. `places/ChIJ...`). */
  placeId: string;
  /** Human display name in the requested language. */
  name: string;
  formattedAddress?: string;
  shortAddress?: string;
  /** Phone numbers — present when the place advertises them. */
  phone?: string;
  internationalPhone?: string;
  /** Canonical website if the place has one. */
  website?: string;
  /** Optional location coords. */
  location?: { latitude: number; longitude: number };
  /** Operating status — `OPERATIONAL` / `CLOSED_TEMPORARILY` / `CLOSED_PERMANENTLY`. */
  businessStatus?: string;
  /** All Google Places types attached to the row (`cafe`, `coffee_shop`, …). */
  types: string[];
  /** Most-specific type (`coffee_shop`, `mexican_restaurant`, etc.). */
  primaryType?: string;
  priceLevel?: 'PRICE_LEVEL_INEXPENSIVE' | 'PRICE_LEVEL_MODERATE' | 'PRICE_LEVEL_EXPENSIVE' | 'PRICE_LEVEL_VERY_EXPENSIVE';
  /** 0.0 – 5.0 average rating from Google reviews. */
  rating?: number;
  /** Total review count. Useful as a quality / popularity signal. */
  userRatingCount?: number;
  /** True / false for "is this place open right now". Present only when Places had hours. */
  openNow?: boolean;
  /**
   * Editorial summary — Places (New) returns a short tagline for some
   * places. Useful for the LLM when ranking + composing.
   */
  editorialSummary?: string;
}

export interface SearchTextArgs {
  /**
   * Free-text query. Examples: `"specialty coffee in Tokyo"`,
   * `"third wave coffee Mexico City"`. Pre-format the keywords; the
   * wrapper passes them through as-is.
   */
  query: string;
  /**
   * Optional locale for returned strings (`en`, `es`, `pt`, `ja`, etc.).
   * BCP-47; Places treats it as a language code for displayName +
   * formattedAddress. Defaults to `en`.
   */
  languageCode?: string;
  /**
   * Optional region code (ISO-3166-1 alpha-2 — `US`, `JP`, `MX`).
   * Steers ranking toward the region. NOT a strict filter.
   */
  regionCode?: string;
  /**
   * Optional bounded search circle. Center + radius (meters). Caps
   * search to a city neighborhood when you have lodging coords.
   */
  locationBias?: {
    circle: {
      center: { latitude: number; longitude: number };
      radius: number;
    };
  };
  /** Max results 1-20. Places (New) hard cap is 20. */
  limit?: number;
  /** Total request budget in ms. Default 6000. */
  timeoutMs?: number;
}

export interface SearchTextResult {
  /** False on configuration / network / quota / WAF errors. Always set. */
  available: boolean;
  /** Diagnostic when `available: false`. */
  reason?: string;
  /** Top-N hits (≤ `args.limit`). Empty when `available: false`. */
  results: PlacesPlace[];
}

export interface GetPlaceArgs {
  /** `places/<id>` or just the bare id; wrapper normalizes. */
  placeId: string;
  languageCode?: string;
  regionCode?: string;
  timeoutMs?: number;
}

export interface GetPlaceResult {
  available: boolean;
  reason?: string;
  place?: PlacesPlace;
}
