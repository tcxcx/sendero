/**
 * @sendero/sherpa — production-grade visa + passport requirements.
 *
 * Thin wrapper over Sherpa's Requirements API v3 (spec vendored at
 * `openapi/sherpa-requirements-api-v3.json`).  Every call is
 * graceful: on timeout, rate limit, missing key, or non-JSON body we
 * return `{ ok: false, reason, message }` so callers fall back to
 * `@sendero/vault/visa-rules` without halting the flow.
 *
 * Auth: `x-api-key: ${SHERPA_API_KEY}`.
 * Host: `https://requirements-api.joinsherpa.com`.
 * Content: `application/vnd.api+json`.
 *
 * Request access → https://docs.joinsherpa.io
 */

export type { PostTripsArgs, SherpaConfig, SherpaResult } from './client';
export { normalizeTripsResponse, postTrips, resolveSherpaConfig } from './client';
export type {
  Action,
  AncillaryProduct,
  DocumentType,
  EnforcementLevel,
  InformationCategoryGroup,
  InformationCategoryType,
  NormalizedRequirement,
  Price,
  PriceBreakdown,
  ProcedureCategory,
  ProcedureEntity,
  ProcedureEntityAttributes,
  ProcedureSubCategory,
  Product,
  ProductTimes,
  RestrictionEntity,
  RestrictionEntityAttributes,
  TravelMoment,
  TravelNode,
  TravelPurpose,
  Traveller,
  TripIncludedEntity,
  TripRequest,
  TripRequestAttributes,
  TripResource,
  TripResourceAttributes,
  TripResourceRedirect,
  TripResponse,
  TripsResponseNormalized,
  UtmParams,
  Vaccination,
  VaccinationStatus,
} from './types';
