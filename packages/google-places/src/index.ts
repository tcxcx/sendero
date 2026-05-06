/**
 * @sendero/google-places — Google Places API (New) wrapper.
 *
 * Generic primitive used by HP1/HP2 anticipation tools. Composes with
 * `cseSearch` from `@sendero/web-search` — CSE finds editorial sources;
 * Places gives canonical metadata + coords + ratings + opening hours.
 *
 * Single-owner pattern: all anticipation tools that touch Places call
 * through this wrapper, never `places.googleapis.com` directly. Adds:
 *   - per-tenant cost-cap hooks (TODO: PR-A1)
 *   - shared field mask (cost discipline)
 *   - Bun-fetch-vs-curl resilience (parity with @sendero/web-search)
 *   - typed PlacesPlace shape (no raw API responses leak downstream)
 */

export { getPlacesApiKey, isPlacesEnabled } from './client';
export { searchText } from './searchText';
export { getPlace } from './getPlace';
export type {
  GetPlaceArgs,
  GetPlaceResult,
  PlacesPlace,
  SearchTextArgs,
  SearchTextResult,
} from './types';
