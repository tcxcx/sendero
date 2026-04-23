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
