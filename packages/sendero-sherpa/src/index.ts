/**
 * @sendero/sherpa — production-grade visa + passport requirements.
 *
 * Thin wrapper over Sherpa's Requirements API v3 (`POST /v3/trips`,
 * `application/vnd.api+json`).  Every call is graceful: on timeout,
 * rate limit, or missing API key we return `{ ok: false }` so
 * callers can fall back to the curated corridor table in
 * `@sendero/vault/visa-rules` without halting the flow.
 */

export type { SherpaConfig, SherpaResult } from './client';
export { postTrips, resolveSherpaConfig } from './client';
export type { SherpaRequirement, TripsRequest, TripsResponse } from './types';
