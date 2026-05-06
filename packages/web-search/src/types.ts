/**
 * @sendero/web-search/types — public type surface.
 */

export interface CseSearchArgs {
  /** The search query string. Will be quoted as-is; caller pre-formats keywords. */
  query: string;
  /**
   * Restrict to a single site (e.g. `'lu.ma'`). Produces a `site:<host>`
   * prefix in the actual query. Useful for `luma_event_discovery`,
   * `meetup_event_discovery`, etc. that want to scope to one source.
   */
  site?: string;
  /**
   * Country code restrictor (CSE `gl` parameter — two-letter ISO).
   * Boosts results from this country in the ranking.
   */
  country?: string;
  /**
   * Language hint (CSE `hl` parameter — two-letter ISO).
   * Affects UI strings and result language preference.
   */
  lang?: string;
  /**
   * Date restrictor: `d1` past day, `d7` past week, `d30` past month,
   * `y1` past year. Useful for event discovery (recency matters).
   */
  freshness?: 'd1' | 'd7' | 'd30' | 'y1';
  /** Max results 1-10 (CSE per-page hard cap). */
  limit?: number;
  /** Pagination start, 1-indexed. */
  start?: number;
  /** Total request budget in ms. Default 5000. */
  timeoutMs?: number;
}

export interface CseSearchHit {
  title: string;
  snippet: string;
  link: string;
  displayLink: string;
  formattedUrl: string;
  htmlSnippet?: string;
  cacheId?: string;
  /** CSE returns rich structured data (cse_thumbnail, opening_hours, etc.) here. */
  pagemap?: Record<string, unknown>;
}

export interface CseSearchResult {
  /** False on configuration / network / quota / WAF errors. Always set. */
  available: boolean;
  /** Diagnostic when `available: false`. */
  reason?: string;
  /** Top-N hits (≤ `args.limit`). Empty when `available: false`. */
  results: CseSearchHit[];
  /** Total estimated matches (string per CSE API shape). */
  totalResults?: string;
  /** CSE search latency in seconds. */
  searchTime?: number;
}
