/**
 * Sherpa Requirements API v3 — TypeScript view.
 *
 * Mirrors the Swagger 2.0 spec vendored at
 * `openapi/sherpa-requirements-api-v3.json` (`info.version` 3.0.3).
 * We model only the wire shapes Sendero actually consumes, plus a
 * normalized layer (`NormalizedRequirement`) that the rest of the
 * platform uses.
 *
 * Spec source of truth — when Sherpa rev's the API, diff the JSON
 * against this file and update both sides.  The JSON stays authoritative
 * for request/response schemas; these types are a convenience view.
 */

// ── Requests ────────────────────────────────────────────────────────

/** One leg of the trip. Origin, destination, or intermediate transit. */
export interface TravelNode {
  type: 'ORIGIN' | 'DESTINATION' | 'TRANSIT';
  /** ISO 3166-1 alpha-3 country code (e.g. "USA", "CAN", "BRA"). */
  locationCode: string;
  /** IATA airport code (e.g. "JFK", "YYZ"). Optional for country-level. */
  airportCode?: string;
  /** Departure fact for ORIGIN + TRANSIT-out nodes. */
  departure?: TravelMoment;
  /** Arrival fact for DESTINATION + TRANSIT-in nodes. */
  arrival?: TravelMoment;
}

export interface TravelMoment {
  /** YYYY-MM-DD. */
  date: string;
  /** HH:MM:SS (optional). */
  time?: string;
  /** 'AIR' | 'LAND' | 'SEA'. */
  travelMode: 'AIR' | 'LAND' | 'SEA';
}

export type TravelPurpose = 'TOURISM' | 'BUSINESS' | 'TRANSIT' | 'MEDICAL';

export type VaccinationStatus =
  | 'FULLY_VACCINATED'
  | 'PARTIALLY_VACCINATED'
  | 'NOT_VACCINATED'
  | 'BOOSTED';

export interface Vaccination {
  type: 'COVID_19' | 'YELLOW_FEVER' | 'OTHER';
  status: VaccinationStatus;
}

export interface Traveller {
  /** ISO 3166-1 alpha-3 codes. Sherpa picks the "best" passport for
   *  each leg based on nationality rules. */
  passports: string[];
  travelPurposes?: TravelPurpose[];
  vaccinations?: Vaccination[];
}

export interface TripRequestAttributes {
  /** BCP-47 locale for localized text in the response. */
  locale?: string;
  /** ISO-4217 currency for product prices in the response. */
  currency?: string;
  travelNodes: TravelNode[];
  traveller: Traveller;
}

export interface TripRequest {
  data: {
    type: 'TRIP';
    attributes: TripRequestAttributes;
  };
}

/** UTM params appended to `POST /v3/trips?…` (not in body). Merged onto
 *  `redirect.url` values in the response. */
export interface UtmParams {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
}

// ── Responses (raw) ─────────────────────────────────────────────────

export type EnforcementLevel =
  | 'MANDATORY'
  | 'RECOMMENDED'
  | 'MAY_BE_REQUIRED'
  | 'OPTIONAL'
  | 'NOT_REQUIRED'
  | 'UNKNOWN';

export type InformationCategoryType =
  | 'VISA_REQUIREMENTS'
  | 'TRAVEL_RESTRICTIONS'
  | 'PASSPORTS_AND_IDS'
  | 'QUARANTINE'
  | 'VACCINATION_OR_IMMUNIZATION'
  | 'COVID_19_TESTING'
  | 'OTHER_DOCUMENTS'
  | 'DOCUMENTS_AND_FORMS'
  | 'PUBLIC_HEALTH_REQUIREMENTS'
  | 'ADDITIONAL_INFORMATION'
  | 'UPCOMING';

/** Deep link Sherpa returns alongside categories (e.g. "See details"). */
export interface TripResourceRedirect {
  url: string;
  label?: string;
}

export interface InformationCategoryGroup {
  type: InformationCategoryType;
  name: string;
  description?: string;
  headline?: string;
  subheading?: string;
  tooltip?: string;
  enforcement?: EnforcementLevel;
  redirect?: TripResourceRedirect;
  groupings?: Array<{ name?: string; headline?: string; enforcement?: EnforcementLevel }>;
}

export type ProcedureCategory =
  | 'QUARANTINE'
  | 'HEALTH_MEASURES'
  | 'PPE'
  | 'DOC_REQUIREMENT'
  | 'COVID_19_TEST'
  | 'DOC_REQUIRED'
  | 'NO_QUARANTINE'
  | 'NO_COVID_19_TEST'
  | 'HEALTH_ASSESSMENT'
  | 'SANITIZATION'
  | 'RE_ENTRY_PERMIT'
  | 'DEPOSIT_REQUIRED'
  | 'HEALTH_INSURANCE'
  | 'TRAVEL_INSURANCE';

export type ProcedureSubCategory =
  | 'BEFORE_ARRIVAL'
  | 'BEFORE_DEPARTURE'
  | 'IN_FLIGHT'
  | 'ON_ARRIVAL'
  | 'DOMESTIC'
  | 'IN_AIRPORT';

export type DocumentType =
  | 'COVID_TEST_RESULT'
  | 'PASSENGER_LOCATOR_FORM'
  | 'HEALTH_DECLARATION'
  | 'MEDICAL_CERTIFICATE'
  | 'HEALTH_CERTIFICATE'
  | 'QUARANTINE_PLAN'
  | 'TRAVEL_AUTHORIZATION'
  | 'QUARANTINE_FORM'
  | 'EXEMPTION_FORM'
  | 'COVID_19_INSURANCE'
  | 'TRAVEL_DECLARATION'
  | 'MOBILE_APP'
  | 'PRE_REGISTRATION_FORM'
  | 'SURVEILLANCE_FORM'
  | 'RE_ENTRY_PERMIT'
  | 'ACCOMMODATION_BOOKING'
  | 'INSURANCE_PROOF'
  | 'ONLINE_REGISTRATION'
  | 'QUESTIONNAIRE_FORM'
  | 'HEALTH_PASS'
  | 'IN_DESTINATION_PROOF'
  | 'HEALTH_INSURANCE'
  | 'TRAVEL_INSURANCE'
  | 'COVID_RECOVERY_CERTIFICATE'
  | 'COVID_19_VACCINATION'
  | 'VACCINATION_CERTIFICATE'
  | 'IMMUNITY_PROOF'
  | 'YELLOW_FEVER_VACCINATION'
  | 'E_VISA'
  | 'ETA'
  | 'EMBASSY_VISA'
  | 'VISA'
  | 'PAPER_VISA'
  | 'PASSPORT'
  | 'NATIONAL_ID';

export interface Price {
  value: number;
  currency: string;
}

export interface PriceBreakdown {
  type: 'GOVERNMENT_FEE' | 'APPLICATION_SERVICE_FEE' | string;
  price: Price;
  name?: string;
}

export interface ProductTimes {
  applicationDeadline?: { type: 'HOURS' | 'DAYS'; value: number; text?: string };
  processingTime?: { type: 'HOURS' | 'DAYS'; value: number; text?: string };
}

/** Ancillary purchasable product — e.g. USA_ESTA, CAN_ETA, IND_EVISA. */
export interface Product {
  productId: string;
  programId: string;
  name: string;
  destinations: string[];
  travelPurposes: string[];
  price: Price;
  priceBreakdown: PriceBreakdown[];
  times: ProductTimes;
}

/** An actionable CTA Sherpa attaches to a procedure — typically an
 *  apply link (type: LINK, intent: apply-product) that opens their
 *  co-branded widget.  `product` is present when `intent === 'apply-product'`. */
export interface Action {
  type: 'LINK' | 'DOWNLOAD' | 'INSTRUCTION';
  title: string;
  url: string;
  provider: string;
  intent?: string;
  productId?: string;
  product?: Product;
  description?: string;
}

export interface ProcedureEntityAttributes {
  category: ProcedureCategory;
  subCategory: ProcedureSubCategory;
  title: string;
  description?: string;
  enforcement: EnforcementLevel;
  tags: string[];
  documentTypes?: DocumentType[];
  actions?: Action[];
  travelPurposes?: TravelPurpose[];
  location?: string;
  airport?: string;
  lengthOfStay?: Array<{ type: 'DAYS' | 'HOURS'; value: number; text?: string }>;
  lastUpdatedAt?: string;
  createdAt?: string;
  startDate?: string | null;
  endDate?: string | null;
  sources?: Array<{ title?: string; type?: string; url?: string }>;
  included?: unknown[];
  excluded?: unknown[];
  more?: string[];
}

export interface ProcedureEntity {
  type: 'PROCEDURE';
  id: string;
  attributes: ProcedureEntityAttributes;
}

export interface RestrictionEntityAttributes {
  category: string;
  subCategory?: string;
  title: string;
  description?: string;
  enforcement: EnforcementLevel;
  tags?: string[];
  location?: string;
  airport?: string;
  lastUpdatedAt?: string;
  createdAt?: string;
  actions?: Action[];
  sources?: Array<{ title?: string; type?: string; url?: string }>;
}

export interface RestrictionEntity {
  type: 'RESTRICTION';
  id: string;
  attributes: RestrictionEntityAttributes;
}

export type TripIncludedEntity = ProcedureEntity | RestrictionEntity;

export interface TripResourceAttributes {
  traveller?: Traveller;
  locale?: string;
  currency?: string;
  travelNodes?: TravelNode[];
  /** Categorized headline buckets (the user-facing grouping). */
  categories?: InformationCategoryGroup[];
  /** Trip-level deep link (UTM-merged). */
  redirect?: TripResourceRedirect;
  /** Free-form alerts / advisories. */
  alerts?: string[];
}

export interface TripResource {
  id: string;
  type: 'TRIP';
  attributes: TripResourceAttributes;
  relationships?: {
    procedures?: { data: Array<{ type: 'PROCEDURE'; id: string }>; meta?: { count: number } };
    restrictions?: {
      data: Array<{ type: 'RESTRICTION'; id: string }>;
      meta?: { count: number };
    };
  };
}

export interface TripResponse {
  data: TripResource;
  included?: TripIncludedEntity[];
  meta?: { copyright?: string; version?: string };
}

// ── Normalized (Sendero's view) ─────────────────────────────────────

/**
 * One requirement after we fold Sherpa's PROCEDURE + RESTRICTION shapes
 * into a single row the booking UI + agent tools can reason about.
 * This is the layer @sendero/vault and the tools package consume.
 */
export interface NormalizedRequirement {
  /** Coarse bucket for the booking UI. */
  kind:
    | 'visa_required'
    | 'visa_free'
    | 'visa_on_arrival'
    | 'eta_required'
    | 'evisa_required'
    | 'passport_validity'
    | 'vaccination_required'
    | 'document_required'
    | 'travel_restriction'
    | 'other';
  /** Short machine code — stable across locales. */
  code: string;
  /** Does this block the booking if unsatisfied. */
  blocking: boolean;
  /** Origin location (ISO-3). */
  location: string | null;
  /** Sherpa's stable entity id — links back to the /v2 detail endpoint. */
  entityId: string;
  /** Ancillary purchasable product, when Sherpa exposes one. Unlocks
   *  the in-booking visa-add-on CTA. */
  ancillary: AncillaryProduct | null;
}

/** A purchasable travel-document product — the visa-ancillary hook. */
export interface AncillaryProduct {
  productId: string;
  productKind: 'visa_apply' | 'eta_apply' | 'evisa_apply' | 'other';
  label: string;
  /** Minor-unit price (cents).  Null when Sherpa defers quote. */
  priceMinor: number | null;
  currency: string | null;
  /** Co-branded apply URL, UTM-merged from the request. */
  applyUrl: string;
  /** When present, the latest time before departure the traveler can
   *  still submit this application. */
  applicationDeadline: { type: 'HOURS' | 'DAYS'; value: number } | null;
  priceBreakdown: PriceBreakdown[];
}

export interface TripsResponseNormalized {
  sherpaTripId: string;
  requirements: NormalizedRequirement[];
  /** Trip-level deep link the booking UI can surface as "See details". */
  tripRedirect: TripResourceRedirect | null;
  /** Categorized display buckets — handy when rendering Sherpa's headline
   *  copy in their intended UX shape. */
  categories: InformationCategoryGroup[];
  /** Free-form alerts — surface as an info banner if present. */
  alerts: string[];
  /** Raw body for audit / replay. Never exposed to the LLM. */
  raw: TripResponse;
}
