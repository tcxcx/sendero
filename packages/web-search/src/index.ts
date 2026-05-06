/**
 * @sendero/web-search — web-search wedge for HP1/HP2 anticipation tools.
 *
 * Single owner of Google Custom Search calls. All HP1/HP2 tools that
 * need editorial / source-URL discovery (specialty_coffee_finder,
 * cheap_michelin_finder, professional_networking_scanner,
 * monocle_place_researcher, etc.) compose `cseSearch()` rather than
 * calling Google's API directly.
 */

export { getCseApiKey, getCseEngineId, isCseEnabled } from './client';
export { cseSearch } from './cse';
export type {
  CseSearchArgs,
  CseSearchHit,
  CseSearchResult,
} from './types';
