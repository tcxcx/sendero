/**
 * @sendero/duffel — shared Duffel API types.
 *
 * Hand-authored against the REST API + the @duffel/api SDK (v4.24.x).
 * Used by the wrapper in `index.ts`, the webhook parser in `webhook.ts`,
 * and downstream consumers (tools, workflows, dispatcher).
 *
 * Design principles:
 *   - Snake_case fields mirror Duffel's wire format exactly.
 *   - We never `cast as any`. If the SDK's type disagrees with the wire
 *     format, we bridge via these types + a narrow `as unknown as T`.
 *   - Unknown fields are permitted via `& { [k: string]: unknown }` only
 *     where Duffel explicitly documents free-form payloads.
 */

export type DuffelLanguageCode = string; // BCP-47 ("en", "fr", "pt-BR")
export type DuffelRegionCode = string; // ISO-3166-1 alpha-2
export type DuffelCurrencyCode = string; // ISO-4217

/** ID prefix conventions enforced by Duffel. */
export type DuffelOfferId = `off_${string}`;
export type DuffelOrderId = `ord_${string}`;
export type DuffelPassengerId = `pas_${string}`;
export type DuffelServiceId = `ase_${string}` | `sea_${string}`;
export type DuffelCustomerUserId = `icu_${string}`;
export type DuffelCustomerUserGroupId = `grp_${string}` | `usg_${string}`;
export type DuffelWebhookId = `end_${string}` | `sev_${string}`;
export type DuffelWebhookEventId = `wev_${string}`;

// ─── Identity: Customer Users + Customer User Groups ───────────────────

export interface DuffelCustomerUserPayloadWire {
  email: string;
  given_name: string;
  family_name: string;
  phone_number?: string | null;
  group_id?: DuffelCustomerUserGroupId | null;
  /** Documented but absent from the SDK type as of v4.24. */
  preferred_language?: DuffelLanguageCode | null;
}

export interface DuffelCustomerUserWire {
  id: DuffelCustomerUserId;
  email: string;
  given_name: string;
  family_name: string;
  phone_number: string | null;
  preferred_language: DuffelLanguageCode | null;
  group: { id: DuffelCustomerUserGroupId; name: string } | null;
  created_at: string;
  live_mode: boolean;
}

export interface DuffelCustomerUserGroupPayloadWire {
  name: string;
  /** Required by SDK type but can be an empty array. */
  user_ids: DuffelCustomerUserId[];
}

export interface DuffelCustomerUserGroupWire {
  id: DuffelCustomerUserGroupId;
  name: string;
  user_ids?: DuffelCustomerUserId[];
  created_at?: string;
}

// ─── Offers + Orders (the subset the wrapper touches) ──────────────────

export interface DuffelOfferPassengerWire {
  id: DuffelPassengerId;
  type: 'adult' | 'child' | 'infant_without_seat';
  age?: number;
}

export interface DuffelOfferWireMinimal {
  id: DuffelOfferId;
  total_amount: string;
  total_currency: DuffelCurrencyCode;
  passengers: DuffelOfferPassengerWire[];
  available_services?: DuffelAvailableServiceWire[];
  // Everything else is passed through to consumers that need it.
  [k: string]: unknown;
}

// ─── Ancillary services (bags, CFAR, seats) ────────────────────────────

export interface DuffelAvailableServiceBaseWire {
  id: DuffelServiceId;
  type: string;
  maximum_quantity: number;
  passenger_ids: DuffelPassengerId[];
  segment_ids: string[];
  total_amount: string;
  total_currency: DuffelCurrencyCode;
}

export interface DuffelAvailableServiceBaggageWire extends DuffelAvailableServiceBaseWire {
  type: 'baggage';
  metadata: {
    type: 'carry_on' | 'checked';
    maximum_weight_kg?: number | null;
    maximum_height_cm?: number | null;
    maximum_length_cm?: number | null;
    maximum_depth_cm?: number | null;
  };
}

export interface DuffelAvailableServiceCFARWire extends DuffelAvailableServiceBaseWire {
  type: 'cancel_for_any_reason';
  metadata: {
    refund_amount?: string;
    merchant_copy?: string;
    terms_and_conditions_url?: string;
  };
}

export type DuffelAvailableServiceWire =
  | DuffelAvailableServiceBaggageWire
  | DuffelAvailableServiceCFARWire
  | (DuffelAvailableServiceBaseWire & { metadata?: Record<string, unknown> });

// ─── Seat map ──────────────────────────────────────────────────────────

export interface DuffelSeatElementServiceWire {
  id: DuffelServiceId;
  passenger_id: DuffelPassengerId;
  total_amount: string;
  total_currency: DuffelCurrencyCode;
}

export interface DuffelSeatElementWire {
  type: 'seat' | 'empty' | 'exit_row' | 'lavatory' | 'galley' | string;
  designator?: string;
  name?: string;
  disclosures?: string[];
  available_services?: DuffelSeatElementServiceWire[];
}

export interface DuffelSeatRowSectionWire {
  elements: DuffelSeatElementWire[];
}

export interface DuffelSeatRowWire {
  sections: DuffelSeatRowSectionWire[];
}

export interface DuffelSeatCabinWire {
  cabin_class?: 'economy' | 'premium_economy' | 'business' | 'first' | string;
  deck?: number;
  rows: DuffelSeatRowWire[];
}

export interface DuffelSeatMapWire {
  id: string;
  segment_id: string;
  cabins: DuffelSeatCabinWire[];
}

// ─── Create Order ──────────────────────────────────────────────────────

export type DuffelOrderType = 'instant' | 'pay_later' | 'hold';

export interface DuffelCreateOrderServiceWire {
  id: DuffelServiceId;
  quantity: number;
}

export interface DuffelCreateOrderPassengerWire {
  id: DuffelPassengerId | string;
  type: 'adult' | 'child' | 'infant_without_seat';
  title: 'mr' | 'mrs' | 'ms' | 'miss' | 'dr' | string;
  given_name: string;
  family_name: string;
  email: string;
  phone_number: string;
  born_on: string;
  gender: 'm' | 'f';
  /** Link to an existing Duffel CustomerUser for Travel Support Assistant. */
  user_id?: DuffelCustomerUserId;
}

export interface DuffelCreateOrderWire {
  selected_offers: DuffelOfferId[];
  type: DuffelOrderType;
  passengers: DuffelCreateOrderPassengerWire[];
  services?: DuffelCreateOrderServiceWire[];
  /** Order-level access list (personal assistants, team leads). */
  users?: DuffelCustomerUserId[];
  metadata?: Record<string, string>;
  payments?: Array<{
    type: 'balance' | 'card' | 'arc_bsp_cash';
    currency: DuffelCurrencyCode;
    amount: string;
  }>;
}

// ─── Webhook events ────────────────────────────────────────────────────
//
// Duffel sends events like this (per public docs):
//   { id: wev_…, type, object, data: { object: {...} }, idempotency_key,
//     created_at, live_mode }
// and signs with header: `X-Duffel-Signature: t=…,v1=…`. Some older
// docs also show a simple hex signature — parsers should tolerate both.

export type DuffelWebhookEventKind =
  | 'ping.triggered'
  | 'order.created'
  | 'order.updated'
  | 'order.issued'
  | 'order.cancelled'
  | 'order.airline_initiated_change_detected'
  | 'order.airline_initiated_change.detected' // legacy dotted form seen in some envs
  | 'service.refunded';

export interface DuffelWebhookEnvelopeWire<Data = Record<string, unknown>> {
  id: DuffelWebhookEventId;
  type: DuffelWebhookEventKind | (string & {});
  object?: string;
  live_mode?: boolean;
  idempotency_key?: string;
  created_at?: string;
  updated_at?: string | null;
  data: {
    id?: string;
    /** Newer envelopes wrap the resource under `data.object`. */
    object?: Record<string, unknown>;
    /** Older envelopes include `status` at the top of data. */
    status?: string;
    [k: string]: unknown;
  };
}

/** Canonical lifecycle state derived from a webhook envelope. */
export type DuffelLifecycleStatus =
  | 'pending'
  | 'ticketed'
  | 'cancelled'
  | 'failed'
  | 'schedule_changed'
  | 'refunded'
  | 'ping';

// ─── Places suggestions (airport / city radius search) ─────────────────

export interface DuffelPlaceSuggestionWire {
  /** 'airport' | 'city' | other — Duffel adds kinds over time. */
  type: 'airport' | 'city' | string;
  id: string;
  name: string;
  time_zone: string;
  latitude: number;
  longitude: number;
  icao_code?: string;
  iata_code?: string;
  iata_city_code?: string;
  iata_country_code?: string;
  city_name?: string;
  city?: {
    id: string;
    name: string;
    iata_code?: string;
    iata_country_code?: string;
  };
}

// ─── Offer / Order conditions (change + refund before departure) ───────
//
// Per Duffel: either field can be `null` (we don't know), or present with
// `allowed: boolean` + optional `penalty_amount` / `penalty_currency`.

export interface DuffelConditionBeforeDepartureWire {
  allowed: boolean;
  penalty_amount: string | null;
  penalty_currency: DuffelCurrencyCode | null;
}

export interface DuffelConditionsWire {
  change_before_departure: DuffelConditionBeforeDepartureWire | null;
  refund_before_departure: DuffelConditionBeforeDepartureWire | null;
  priority_boarding?: string | null;
  priority_check_in?: string | null;
  advance_seat_selection?: string | null;
}

// Slice conditions never include refund_before_departure (refunds are
// always at the order level — can't refund one slice).
export interface DuffelSliceConditionsWire {
  change_before_departure: DuffelConditionBeforeDepartureWire | null;
}

// ─── Private fares (corporate + leisure + loyalty) ─────────────────────
//
// `private_fares` is a map keyed by IATA airline code. Each entry is an
// array of credentials. Different airlines require different fields — we
// accept the superset and let the airline validate.

export interface DuffelPrivateFareCredentialWire {
  corporate_code?: string;
  tour_code?: string;
  /** Corporate loyalty programmes (AA AAdvantage Business etc.). */
  tracking_reference?: string;
  /** Account identifier for loyalty programmes that need one explicitly. */
  account_number?: string;
}

/** Map keyed by IATA airline code (e.g. "AA", "UA", "WN"). */
export type DuffelPrivateFaresMap = Record<string, DuffelPrivateFareCredentialWire[]>;

export interface DuffelPrivateFareAppliedWire {
  type: 'corporate' | 'leisure' | 'negotiated' | string;
  corporate_code?: string;
  tour_code?: string;
  tracking_reference?: string;
}

export type DuffelLeisureFareType =
  | 'student'
  | 'senior'
  | 'contract_bulk'
  | 'contract_bulk_child'
  | 'contract_bulk_infant_with_seat'
  | 'contract_bulk_infant_without_seat'
  | 'tour'
  | 'air_crew'
  | 'visiting_friends_and_family'
  | (string & {});

export interface DuffelOfferRequestPassengerWire {
  type?: 'adult' | 'child' | 'infant_without_seat';
  age?: number;
  fare_type?: DuffelLeisureFareType;
  user_id?: DuffelCustomerUserId;
  loyalty_programme_accounts?: Array<{
    airline_iata_code: string;
    account_number: string;
  }>;
}

export interface DuffelOfferRequestSliceWire {
  origin: string;
  destination: string;
  departure_date: string;
}

export interface DuffelOfferRequestCreateWire {
  slices: DuffelOfferRequestSliceWire[];
  passengers: DuffelOfferRequestPassengerWire[];
  cabin_class?: 'economy' | 'premium_economy' | 'business' | 'first';
  return_offers?: boolean;
  max_connections?: number;
  private_fares?: DuffelPrivateFaresMap;
  /** Duffel-managed airline-credit pool to try against this search. */
  airline_credit_ids?: string[];
}

// ─── Airline credits ───────────────────────────────────────────────────

export type DuffelAirlineCreditId = `acd_${string}`;

export interface DuffelAirlineCreditWire {
  id: DuffelAirlineCreditId;
  code: string;
  amount: string;
  amount_currency: DuffelCurrencyCode;
  type: 'eticket' | 'mco' | (string & {});
  airline_iata_code: string;
  issued_on: string;
  live_mode: boolean;
  expires_at: string | null;
  spent_at: string | null;
  invalidated_at: string | null;
  given_name: string | null;
  family_name: string | null;
  passenger_id: DuffelPassengerId | null;
  order_id: DuffelOrderId | null;
  user_id: DuffelCustomerUserId | null;
  created_at: string;
}

export interface DuffelAirlineCreditCreateWire {
  airline_iata_code: string;
  code: string;
  amount: string;
  amount_currency: DuffelCurrencyCode;
  issued_on: string;
  expires_at: string;
  type: 'eticket' | 'mco';
  given_name?: string;
  family_name?: string;
  user_id?: DuffelCustomerUserId;
}

// ─── Order cancellations ───────────────────────────────────────────────

export type DuffelOrderCancellationId = `ore_${string}`;
export type DuffelRefundDestination =
  | 'original_form_of_payment'
  | 'airline_credits'
  | 'arc_bsp_cash'
  | 'voucher'
  | (string & {});

export interface DuffelCancellationAirlineCreditWire {
  passenger_id: DuffelPassengerId;
  credit_name: string;
  credit_currency: DuffelCurrencyCode;
  credit_amount: string;
  credit_code: string | null;
  issued_on?: string;
  expires_at?: string | null;
}

export interface DuffelOrderCancellationWire {
  id: DuffelOrderCancellationId;
  order_id: DuffelOrderId;
  refund_currency: DuffelCurrencyCode | null;
  refund_amount: string | null;
  refund_to: DuffelRefundDestination;
  expires_at: string | null;
  confirmed_at: string | null;
  created_at: string;
  live_mode: boolean;
  airline_credits?: DuffelCancellationAirlineCreditWire[];
}

// ─── Stays (hotels): quotes, bookings, loyalty, cancellation timeline ─

export type DuffelStaysSearchResultId = `res_${string}`;
export type DuffelStaysRateId = `rat_${string}`;
export type DuffelStaysQuoteId = `quo_${string}`;
export type DuffelStaysBookingId = `boo_${string}`;
export type DuffelStaysAccommodationId = `acc_${string}`;
export type DuffelStaysNegotiatedRateId = `nre_${string}`;

export type DuffelStaysPaymentType = 'pay_now' | 'deposit' | 'guarantee' | (string & {});

export interface DuffelStaysCancellationTimelineEntryWire {
  /** Amount refundable up until `before`. */
  refund_amount: string;
  before: string;
  currency: DuffelCurrencyCode;
}

export interface DuffelStaysSupportedLoyaltyProgrammeWire {
  reference: string;
  name?: string;
  logo_url?: string;
}

export interface DuffelStaysRateConditionWire {
  title: string;
  description?: string;
}

export interface DuffelStaysRateWire {
  id: DuffelStaysRateId;
  total_amount: string;
  total_currency: DuffelCurrencyCode;
  due_at_accommodation_amount?: string | null;
  due_at_accommodation_currency?: DuffelCurrencyCode | null;
  payment_type?: DuffelStaysPaymentType;
  cancellation_timeline?: DuffelStaysCancellationTimelineEntryWire[];
  supported_loyalty_programme?: DuffelStaysSupportedLoyaltyProgrammeWire | null;
  rate_code?: string | null;
  negotiated_rate_id?: DuffelStaysNegotiatedRateId | null;
  conditions?: DuffelStaysRateConditionWire[];
  board_type?:
    | 'room_only'
    | 'breakfast'
    | 'half_board'
    | 'full_board'
    | 'all_inclusive'
    | (string & {});
  available_rooms?: number;
}

export interface DuffelStaysQuotePayloadWire {
  rate_id: DuffelStaysRateId;
}

export interface DuffelStaysQuoteWire {
  id: DuffelStaysQuoteId;
  total_amount: string;
  total_currency: DuffelCurrencyCode;
  due_at_accommodation_amount?: string | null;
  due_at_accommodation_currency?: DuffelCurrencyCode | null;
  check_in_date: string;
  check_out_date: string;
  expires_at?: string;
  cancellation_timeline?: DuffelStaysCancellationTimelineEntryWire[];
  payment_type?: DuffelStaysPaymentType;
  supported_loyalty_programme?: DuffelStaysSupportedLoyaltyProgrammeWire | null;
  conditions?: DuffelStaysRateConditionWire[];
}

export interface DuffelStaysGuestPayloadWire {
  given_name: string;
  family_name: string;
  born_on?: string;
  user_id?: DuffelCustomerUserId;
}

export interface DuffelStaysBookingPayloadWire {
  quote_id: DuffelStaysQuoteId;
  phone_number?: string;
  email: string;
  guests: DuffelStaysGuestPayloadWire[];
  accommodation_special_requests?: string;
  loyalty_programme_account_number?: string;
  metadata?: Record<string, string>;
  users?: DuffelCustomerUserId[];
  payment?: {
    three_d_secure_session_id?: string;
  };
}

export interface DuffelStaysBookingWire {
  id: DuffelStaysBookingId;
  reference: string;
  status: 'confirmed' | 'cancelled' | 'failed' | (string & {});
  total_amount: string;
  total_currency: DuffelCurrencyCode;
  check_in_date: string;
  check_out_date: string;
  cancellation_timeline?: DuffelStaysCancellationTimelineEntryWire[];
  created_at: string;
  accommodation?: {
    id: DuffelStaysAccommodationId;
    name: string;
    rating?: number | null;
    address?: {
      city_name?: string;
      country_code?: string;
      line_one?: string;
      postal_code?: string;
    };
  };
  supported_loyalty_programme?: DuffelStaysSupportedLoyaltyProgrammeWire | null;
}

export interface DuffelStaysNegotiatedRatePayloadWire {
  display_name: string;
  rate_access_code: string;
  accommodation_ids: DuffelStaysAccommodationId[];
}

export interface DuffelStaysNegotiatedRateWire {
  id: DuffelStaysNegotiatedRateId;
  display_name: string;
  rate_access_code: string;
  accommodation_ids: DuffelStaysAccommodationId[];
  live_mode: boolean;
}
