/**
 * Duffel client — flight search, hold orders, balance payment.
 *
 * Uses hold-then-pay model:
 *   1. createHoldOrder(type: 'hold') → reserves seat without payment
 *   2. payFromBalance() → debits Duffel Balance (pre-funded via Circle)
 *   3. Ticket issued
 *
 * Duffel charges in your billing currency (GBP for UK-based orgs, etc.).
 * Balance top-up is a treasury operation, not per-booking.
 */

import { Duffel } from '@duffel/api';
import type {
  CreatePayment,
  Guest,
  Offer,
  OfferRequest,
  Payment,
  StaysSearchResponse,
  StaysSearchResult,
} from '@duffel/api/types';
import { env } from '@sendero/env';
import { z } from 'zod';

import type {
  DuffelAirlineCreditCreateWire,
  DuffelAirlineCreditId,
  DuffelAirlineCreditWire,
  DuffelAvailableServiceBaggageWire,
  DuffelAvailableServiceCFARWire,
  DuffelAvailableServiceWire,
  DuffelConditionsWire,
  DuffelCreateOrderWire,
  DuffelCurrencyCode,
  DuffelCustomerUserGroupPayloadWire,
  DuffelCustomerUserGroupWire,
  DuffelCustomerUserId,
  DuffelCustomerUserPayloadWire,
  DuffelCustomerUserWire,
  DuffelLeisureFareType,
  DuffelOfferRequestCreateWire,
  DuffelOfferRequestPassengerWire,
  DuffelOfferWireMinimal,
  DuffelOrderCancellationId,
  DuffelOrderCancellationWire,
  DuffelOrderChangeId,
  DuffelOrderChangeOfferId,
  DuffelOrderChangeOfferWire,
  DuffelOrderChangeRequestId,
  DuffelOrderChangeRequestWire,
  DuffelOrderChangeSliceAdd,
  DuffelOrderChangeSliceRemove,
  DuffelOrderChangeWire,
  DuffelOrderId,
  DuffelPlaceSuggestionWire,
  DuffelPrivateFaresMap,
  DuffelSeatMapWire,
  DuffelServiceId,
  DuffelStaysBookingPayloadWire,
  DuffelStaysBookingWire,
  DuffelStaysQuoteId,
  DuffelStaysQuoteWire,
  DuffelStaysRateId,
} from './types';

export * from './types';
export {
  type DuffelWebhookEvent,
  type DuffelWebhookEventType,
  type DuffelWebhookStatus,
  parseDuffelWebhook,
  verifyDuffelSignature,
} from './webhook';

let client: Duffel | null = null;

export function getDuffel(): Duffel {
  if (!client) {
    const token = env.duffelApiToken();
    if (!token) {
      throw new Error('DUFFEL_API_TOKEN not set. Add it to .env.local.');
    }
    client = new Duffel({ token });
  }
  return client;
}

export interface FlightSearchParams {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate?: string;
  passengers?: number;
  cabinClass?: 'economy' | 'premium_economy' | 'business' | 'first';
  /**
   * Corporate negotiated fares + corporate loyalty programmes keyed by
   * airline IATA code. E.g. `{ "AA": [{ corporate_code, tour_code }], "UA":
   * [{ tour_code }] }`. See https://duffel.com/docs/guides/accessing-corporate-private-fares
   * and https://duffel.com/docs/guides/adding-corporate-loyalty-programme-accounts.
   */
  privateFares?: DuffelPrivateFaresMap;
  /**
   * Per-passenger leisure private-fare type (student, contract_bulk, etc).
   * Pass one per passenger slot (same order as Duffel passengers list).
   * See https://duffel.com/docs/guides/accessing-leisure-private-fares.
   */
  leisureFareTypes?: Array<DuffelLeisureFareType | undefined>;
  /**
   * Match offers against a Duffel CustomerUser so their attached
   * airline_credits surface as `available_airline_credit_ids[]`.
   */
  customerUserId?: DuffelCustomerUserId;
  /**
   * Explicit airline-credit pool to test against this search.
   */
  airlineCreditIds?: DuffelAirlineCreditId[];
  /** Loyalty programme accounts per passenger (same order as passengers). */
  loyaltyProgrammeAccounts?: Array<Array<{ airlineIataCode: string; accountNumber: string }>>;
}

export interface FlightOfferSummary {
  id: string;
  airline: string;
  airlineIataCode: string;
  /** Square logo (SVG), usable as a small chip. */
  airlineLogoUrl: string | null;
  /** Full logo with wordmark, usable in larger surfaces. */
  airlineLockupUrl: string | null;
  /** Airline brand colour, if Duffel exposes it. */
  airlineConditionsOfCarriageUrl: string | null;
  price: string;
  currency: string;
  departure: string;
  arrival: string;
  originCode: string;
  originCity: string | null;
  destinationCode: string;
  destinationCity: string | null;
  duration: string;
  stops: number;
  cabinClass: string;
  expiresAt: string;
  /**
   * Whether the offer can be held without instant payment.
   * Maps to Duffel's `payment_requirements.requires_instant_payment === false`
   * — only those offers accept `type: 'hold'` on order creation. We surface
   * this on the wire so the UI can hide / disable the "Hold seat" CTA
   * before it round-trips to the airline.
   */
  holdable: boolean;
  /**
   * RFC3339 deadline by which a hold must be paid for, when present. Duffel
   * returns this on holdable offers under `payment_requirements.payment_required_by`.
   */
  paymentRequiredBy: string | null;
  /**
   * Phase B.1 — multi-slice projection. Round-trip offers carry two
   * slices (outbound + return); open-jaw / multi-city carry N. The
   * agent's WhatsApp list / confirm-card / receipt all need each leg's
   * date + route + duration to render. The first-segment / last-segment
   * fields above stay populated for back-compat (one-way callers
   * unchanged); `slices` is the canonical multi-leg surface.
   */
  slices: Array<{
    originCode: string;
    originCity: string | null;
    destinationCode: string;
    destinationCity: string | null;
    /** RFC3339 — first segment's departing_at on this slice. */
    departure: string;
    /** RFC3339 — last segment's arriving_at on this slice. */
    arrival: string;
    /** ISO 8601 duration (Duffel-supplied), e.g. `PT4H47M`. */
    duration: string;
    /** Number of intermediate stops on this slice. 0 = direct. */
    stops: number;
  }>;
  /** True when `slices.length >= 2` — convenience flag for the agent prompt. */
  isRoundTrip: boolean;
  /**
   * Set only when surfaced via `searchFlightsItineraries`. Identifies whether
   * the offer covers the entire trip (`single_ticket`) or only one slice
   * (`split_ticket`). Absent on legacy `searchFlights` results.
   * See https://duffel.com/docs/guides/selling-split-ticket-itineraries.
   */
  offerType?: 'single_ticket' | 'split_ticket';
}

export async function searchFlights(params: FlightSearchParams): Promise<FlightOfferSummary[]> {
  const duffel = getDuffel();

  const passengerCount = params.passengers ?? 1;
  const passengers: DuffelOfferRequestPassengerWire[] = Array.from(
    { length: passengerCount },
    (_unused, idx) => {
      const wire: DuffelOfferRequestPassengerWire = { type: 'adult' };
      const fareType = params.leisureFareTypes?.[idx];
      if (fareType) wire.fare_type = fareType;
      if (idx === 0 && params.customerUserId) wire.user_id = params.customerUserId;
      const loyalty = params.loyaltyProgrammeAccounts?.[idx];
      if (loyalty?.length) {
        wire.loyalty_programme_accounts = loyalty.map(l => ({
          airline_iata_code: l.airlineIataCode,
          account_number: l.accountNumber,
        }));
      }
      return wire;
    }
  );

  const slices: { origin: string; destination: string; departure_date: string }[] = [
    {
      origin: params.origin,
      destination: params.destination,
      departure_date: params.departureDate,
    },
  ];
  if (params.returnDate) {
    slices.push({
      origin: params.destination,
      destination: params.origin,
      departure_date: params.returnDate,
    });
  }

  const body: DuffelOfferRequestCreateWire = {
    slices,
    passengers,
    cabin_class: params.cabinClass ?? 'economy',
    return_offers: true,
  };
  if (params.privateFares && Object.keys(params.privateFares).length) {
    body.private_fares = params.privateFares;
  }
  if (params.airlineCreditIds?.length) {
    body.airline_credit_ids = params.airlineCreditIds;
  }

  const response = await duffel.offerRequests.create(
    body as unknown as Parameters<typeof duffel.offerRequests.create>[0]
  );

  const offerRequest = response.data as unknown as OfferRequest;
  const offers = (offerRequest.offers || []).slice(0, 10);

  return offers.map(o =>
    projectFlightOffer(o as Omit<Offer, 'available_services'>, params.origin, params.destination)
  );
}

/**
 * Project a single Duffel offer to the Sendero-canonical `FlightOfferSummary`.
 * Shared between `searchFlights` (flat result) and `searchFlightsItineraries`
 * (split-ticket grouped result). Fallback origin/destination is used only
 * when the offer itself doesn't expose segment IATA codes — e.g. when the
 * adapter is invoked with city codes (`NYC`) that Duffel re-anchors to a
 * specific airport (`JFK`).
 */
function projectFlightOffer(
  o: Omit<Offer, 'available_services'>,
  fallbackOrigin?: string,
  fallbackDestination?: string,
  offerType?: 'single_ticket' | 'split_ticket'
): FlightOfferSummary {
  const firstSegment = o.slices?.[0]?.segments?.[0];
  const lastSegment = o.slices?.[0]?.segments?.[o.slices[0].segments.length - 1];
  const owner = o.owner;
  const iata = owner?.iata_code || '';
  const projectedSlices = (o.slices ?? []).map(slice => {
    const segs = slice.segments ?? [];
    const first = segs[0];
    const last = segs[segs.length - 1];
    return {
      originCode: first?.origin?.iata_code ?? '',
      originCity: first?.origin?.city_name ?? null,
      destinationCode: last?.destination?.iata_code ?? '',
      destinationCity: last?.destination?.city_name ?? null,
      departure: first?.departing_at ?? '',
      arrival: last?.arriving_at ?? '',
      duration: slice.duration ?? '',
      stops: Math.max(0, segs.length - 1),
    };
  });
  return {
    id: o.id,
    airline: owner?.name || 'Unknown',
    airlineIataCode: iata,
    airlineLogoUrl:
      owner?.logo_symbol_url ||
      (iata
        ? `https://assets.duffel.com/img/airlines/for-light-background/full-color-logo/${iata}.svg`
        : null),
    airlineLockupUrl:
      owner?.logo_lockup_url ||
      (iata
        ? `https://assets.duffel.com/img/airlines/for-light-background/full-color-lockup/${iata}.svg`
        : null),
    airlineConditionsOfCarriageUrl: owner?.conditions_of_carriage_url || null,
    price: o.total_amount,
    currency: o.total_currency,
    departure: firstSegment?.departing_at || '',
    arrival: lastSegment?.arriving_at || '',
    originCode: firstSegment?.origin?.iata_code || fallbackOrigin || '',
    originCity: firstSegment?.origin?.city_name || null,
    destinationCode: lastSegment?.destination?.iata_code || fallbackDestination || '',
    destinationCity: lastSegment?.destination?.city_name || null,
    duration: o.slices?.[0]?.duration || '',
    stops: Math.max(0, (o.slices?.[0]?.segments?.length || 1) - 1),
    cabinClass: firstSegment?.passengers?.[0]?.cabin_class || 'economy',
    expiresAt: o.expires_at,
    holdable: o.payment_requirements?.requires_instant_payment === false,
    paymentRequiredBy: o.payment_requirements?.payment_required_by ?? null,
    slices: projectedSlices,
    isRoundTrip: projectedSlices.length >= 2,
    ...(offerType ? { offerType } : {}),
  };
}

/**
 * Per-slice split-ticket offers as returned by the Duffel itinerary view
 * (`view=itineraries` + `include_split_ticket=true`). Each entry corresponds
 * to one slice of the original search request.
 */
export interface ItinerarySliceOffers {
  /** IATA code of the slice's origin airport. */
  originCode: string;
  /** IATA code of the slice's destination airport. */
  destinationCode: string;
  /** RFC3339 (date-only) departure date for the slice. */
  departureDate: string;
  /**
   * One-way offers covering only this slice. Customer picks one offer per
   * slice; the assembled trip is N independent Duffel orders.
   */
  splitTickets: FlightOfferSummary[];
}

/**
 * Result of `searchFlightsItineraries`. Two parallel arrays — the agent
 * presents the customer with EITHER one `singleTickets` offer (covers the
 * whole trip from one carrier) OR one `splitTickets` offer per slice.
 * Never a mix; that's not a valid Duffel construct.
 *
 * Per Duffel: median 300% more bookable itineraries are unlocked when
 * split-ticket combos are surfaced.
 * https://duffel.com/docs/guides/selling-split-ticket-itineraries
 */
export interface FlightSearchItinerariesResult {
  /**
   * Full-trip offers from a single carrier covering every slice. These
   * book exactly as today's single-ticket flow.
   */
  singleTickets: FlightOfferSummary[];
  /**
   * Per-slice split-ticket offers, in the same order as the original
   * search request's slices.
   */
  slices: ItinerarySliceOffers[];
}

/**
 * Search flights with Duffel's grouped itinerary view, surfacing
 * split-ticket combinations alongside the standard single-ticket offers.
 *
 * Uses raw HTTPS rather than `duffel.offerRequests.create()` because the
 * SDK (v4.24) does not yet model `include_split_ticket` or the
 * `view=itineraries` query param. Auth headers are reused — token comes
 * from `env.duffelApiToken()` same as the SDK path. When/if Duffel
 * promotes split-ticket to the SDK, this can collapse back into the
 * `duffel.offerRequests.create` call site.
 */
export async function searchFlightsItineraries(
  params: FlightSearchParams
): Promise<FlightSearchItinerariesResult> {
  const token = env.duffelApiToken();
  if (!token) throw new Error('DUFFEL_API_TOKEN not set.');

  const passengerCount = params.passengers ?? 1;
  const passengers: DuffelOfferRequestPassengerWire[] = Array.from(
    { length: passengerCount },
    (_unused, idx) => {
      const wire: DuffelOfferRequestPassengerWire = { type: 'adult' };
      const fareType = params.leisureFareTypes?.[idx];
      if (fareType) wire.fare_type = fareType;
      if (idx === 0 && params.customerUserId) wire.user_id = params.customerUserId;
      const loyalty = params.loyaltyProgrammeAccounts?.[idx];
      if (loyalty?.length) {
        wire.loyalty_programme_accounts = loyalty.map(l => ({
          airline_iata_code: l.airlineIataCode,
          account_number: l.accountNumber,
        }));
      }
      return wire;
    }
  );

  const slices: { origin: string; destination: string; departure_date: string }[] = [
    {
      origin: params.origin,
      destination: params.destination,
      departure_date: params.departureDate,
    },
  ];
  if (params.returnDate) {
    slices.push({
      origin: params.destination,
      destination: params.origin,
      departure_date: params.returnDate,
    });
  }

  const body: Record<string, unknown> = {
    slices,
    passengers,
    cabin_class: params.cabinClass ?? 'economy',
    include_split_ticket: true,
    return_offers: true,
  };
  if (params.privateFares && Object.keys(params.privateFares).length) {
    body.private_fares = params.privateFares;
  }
  if (params.airlineCreditIds?.length) {
    body.airline_credit_ids = params.airlineCreditIds;
  }

  const res = await fetch('https://api.duffel.com/air/offer_requests?view=itineraries', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip',
      'Content-Type': 'application/json',
      'Duffel-Version': 'v2',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ data: body }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `duffel.offer_requests (view=itineraries) ${res.status}: ${text.slice(0, 400)}`
    );
  }

  const json = (await res.json()) as { data?: unknown };
  const parsed = duffelItineraryViewResponseSchema.safeParse(json.data);
  if (!parsed.success) {
    // Defensive degradation: Duffel hasn't fully documented the
    // view=itineraries shape yet. A schema miss here is a signal worth
    // logging, but read-only search must not throw and break the
    // agent turn. Return empty so the caller falls back to the flat
    // singleTicket-only view.
    console.warn('[duffel] itinerary-view schema mismatch — returning empty result', {
      error: parsed.error.issues.slice(0, 3),
    });
    return { singleTickets: [], slices: [] };
  }
  return projectItinerariesResponse(parsed.data, params.origin, params.destination);
}

/**
 * Internal shape of the `view=itineraries` response from
 * `POST /air/offer_requests`. Modeled defensively because Duffel hasn't
 * exposed this shape in the TypeScript SDK yet — fields may shift before
 * GA. The schema is intentionally permissive: every field is optional,
 * unknown keys pass through, and every nested array drops null/undefined
 * entries via `.nullable()` + `.transform(filter)` so a single bad row
 * can't blow up projection.
 */

// Origin/destination arrive either as a bare IATA string or as a place
// object. Union covers both Duffel response variants.
const placeRefSchema = z.union([
  z.string(),
  z.object({ iata_code: z.string().optional() }).passthrough(),
]);

// Helper: array of nullable T → array of non-null T after filtering.
// `.catch(null)` makes each element parse-resilient: an inner-schema
// failure produces `null` instead of throwing the whole array. The
// transform then strips nulls. Used so a strict offer-schema that
// requires id/type/total_amount/etc. silently drops malformed offers
// rather than rejecting the entire response (Codex PR54-4).
function nonNullableArray<T extends z.ZodTypeAny>(inner: T) {
  return z
    .array(inner.nullable().catch(null))
    .transform(arr => arr.filter((x): x is z.infer<T> => x !== null && x !== undefined));
}

// Codex PR54-4 — require the minimum fields downstream `projectFlightOffer`
// reads before booking. Offers missing total_amount / total_currency /
// expires_at cannot be priced or held; surfacing them to the agent risks
// a confident-but-broken "found N options" response. Require them and
// let the parser silently drop malformed offers via the nonNullableArray
// wrapper at the brand level (each brand's offers array is `.nullable()`
// then `.transform(filter)`, so a strict-but-failed parse becomes null
// and gets filtered out).
const rawItineraryOfferSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum(['single_ticket', 'split_ticket']),
    total_amount: z.string().min(1),
    total_currency: z.string().min(1),
    expires_at: z.string().min(1),
  })
  .passthrough();

const rawItineraryBrandSchema = z
  .object({
    offers: nonNullableArray(rawItineraryOfferSchema).optional(),
  })
  .passthrough();

const rawItinerarySchema = z
  .object({
    brands: nonNullableArray(rawItineraryBrandSchema).optional(),
  })
  .passthrough();

const rawItinerarySliceSchema = z
  .object({
    origin: placeRefSchema.optional(),
    destination: placeRefSchema.optional(),
    departure_date: z.string().optional(),
    itineraries: nonNullableArray(rawItinerarySchema).optional(),
  })
  .passthrough();

/** Exported for unit tests only. Do not depend on this in app code. */
export const duffelItineraryViewResponseSchema = z
  .object({
    slices: nonNullableArray(rawItinerarySliceSchema).optional(),
  })
  .passthrough();

type DuffelItineraryViewResponseWire = z.infer<typeof duffelItineraryViewResponseSchema>;

type RawItineraryOffer = Omit<Offer, 'available_services'> & {
  type?: 'single_ticket' | 'split_ticket';
};

function extractIataCode(field: unknown): string | undefined {
  if (typeof field === 'string') return field;
  if (field && typeof field === 'object' && 'iata_code' in field) {
    const v = (field as { iata_code?: unknown }).iata_code;
    if (typeof v === 'string') return v;
  }
  return undefined;
}

/** Exported for unit tests only. Do not depend on this in app code. */
export function projectItinerariesResponse(
  data: DuffelItineraryViewResponseWire | undefined,
  fallbackOrigin: string,
  fallbackDestination: string
): FlightSearchItinerariesResult {
  const singleTicketsById = new Map<string, FlightOfferSummary>();
  const sliceBuckets: ItinerarySliceOffers[] = [];

  // Zod transforms have already filtered null/undefined entries out of
  // the nested arrays — the only remaining defense is to skip offers
  // missing an `id` (they're un-projectable + un-bookable).
  for (const rawSlice of data?.slices ?? []) {
    const sliceOrigin = extractIataCode(rawSlice.origin) ?? fallbackOrigin;
    const sliceDestination = extractIataCode(rawSlice.destination) ?? fallbackDestination;
    const bucket: ItinerarySliceOffers = {
      originCode: sliceOrigin,
      destinationCode: sliceDestination,
      departureDate: rawSlice.departure_date ?? '',
      splitTickets: [],
    };

    for (const itinerary of rawSlice.itineraries ?? []) {
      for (const brand of itinerary.brands ?? []) {
        for (const offer of brand.offers ?? []) {
          if (!offer || !offer.id) continue;
          const typedOffer = offer as unknown as RawItineraryOffer;
          if (offer.type === 'single_ticket') {
            if (!singleTicketsById.has(offer.id)) {
              singleTicketsById.set(
                offer.id,
                projectFlightOffer(typedOffer, fallbackOrigin, fallbackDestination, 'single_ticket')
              );
            }
          } else if (offer.type === 'split_ticket') {
            bucket.splitTickets.push(
              projectFlightOffer(typedOffer, sliceOrigin, sliceDestination, 'split_ticket')
            );
          }
          // Defensively ignore offers that arrive without a recognized type;
          // surfacing them would risk presenting a non-bookable combo to
          // the agent.
        }
      }
    }

    sliceBuckets.push(bucket);
  }

  // Cap the number of offers we surface so the agent prompt stays bounded.
  // Single-tickets share the cap; per-slice split-tickets share their own.
  const TOP_N = 10;
  const singleTickets = Array.from(singleTicketsById.values()).slice(0, TOP_N);
  const slices = sliceBuckets.map(b => ({ ...b, splitTickets: b.splitTickets.slice(0, TOP_N) }));

  return { singleTickets, slices };
}

/**
 * Identity-document attached to a Duffel passenger. Phase D — fills
 * the airline + IATA reservation systems with the traveler's real
 * passport so the carrier can check-in at the gate without a
 * "passport not on record" stop. Sendero's vault is the source.
 *
 * Field shapes mirror Duffel's `OrderPassengerIdentityDocument`:
 * `issuing_country_code` + `nationality` are ISO 3166-1 **alpha-2**
 * (Sendero's vault stores alpha-3; convert before passing).
 */
export interface DuffelPassengerIdentityDocument {
  type: 'passport';
  /** Document number as printed on the passport. */
  uniqueIdentifier: string;
  /** Two-letter issuing country code (alpha-2). */
  issuingCountryCode: string;
  /** Two-letter nationality code (alpha-2). */
  nationality?: string;
  /** YYYY-MM-DD expiry date. */
  expiresOn: string;
  /** YYYY-MM-DD issue date (optional). */
  issuedOn?: string;
}

export interface HoldOrderParams {
  offerId: string;
  passengerName: string;
  passengerEmail: string;
  passengerPhone?: string;
  passengerDob?: string;
  passengerGender?: 'male' | 'female';
  /**
   * Phase D — passport / national-id document attached to the
   * passenger. When present, Duffel forwards it to the airline +
   * IATA reservation systems so the gate-side check-in resolves
   * cleanly. When absent, Duffel falls back to PNR-only retrieval
   * which some carriers reject.
   */
  identityDocument?: DuffelPassengerIdentityDocument;
  idempotencyKey: string;
  /**
   * Optional Duffel Customer Users to attach to the order. The first
   * element is also bound to the passenger via `user_id`. Additional
   * entries are added to the order-level `users` array so they unlock
   * Travel Support Assistant access (e.g. personal assistant, team lead).
   * See https://duffel.com/docs/guides/modelling-customers
   */
  customerUserIds?: string[];
  /**
   * Optional ancillary services to attach at order creation time — e.g.
   * baggage, cancel-for-any-reason, or seats. Each entry is a Duffel
   * available-service `id` plus `quantity`. Seat services come from
   * `getSeatMap(offerId)`; bag / CFAR services come from the offer's
   * `available_services` via `getOfferWithServices(offerId)`.
   */
  services?: Array<{ id: string; quantity: number }>;
}

/**
 * Normalized segment projection for downstream persistence (Booking.segments)
 * and downstream tools (`get_active_trip`, NFT stamp prompts, eSIM trigger).
 * Extracted from the Duffel offer at hold-creation time so consumers don't
 * have to round-trip back to Duffel for itinerary metadata.
 */
export interface NormalizedFlightSegment {
  originIata: string;
  destinationIata: string;
  originCity: string | null;
  destinationCity: string | null;
  /** ISO-3166-1 alpha-2 country codes — destination of this segment. */
  originCountry: string | null;
  destinationCountry: string | null;
  carrier: string | null;
  carrierName: string | null;
  flightNumber: string | null;
  cabin: string | null;
  departureAt: string | null;
  arrivalAt: string | null;
  durationMinutes: number | null;
}

export interface HoldOrderResult {
  orderId: string;
  bookingReference: string;
  totalAmount: string;
  totalCurrency: string;
  paymentRequiredBy: string;
  /** Snapshot of the services that were attached at creation time. */
  services: Array<{ id: string; quantity: number }>;
  /**
   * Normalized itinerary projection — first slice's segments. Empty
   * when the Duffel offer didn't carry slice data (rare; defensive).
   * Persistence layer writes this into `Booking.segments` so
   * `get_active_trip` and the post-mint stamp prompts have real
   * destination + carrier + dates without re-fetching Duffel.
   */
  segments: NormalizedFlightSegment[];
  /** Origin IATA of the trip (first segment's origin). */
  originIata: string | null;
  /** Final destination IATA (last segment's destination). */
  destinationIata: string | null;
  /** ISO-3166-1 alpha-2 codes covered by all segments, deduped. */
  destinationIso2: string[];
  /** First-segment departure date (`YYYY-MM-DD`). */
  startDate: string | null;
  /** Last-segment arrival date (`YYYY-MM-DD`) when known. */
  endDate: string | null;
  /** Raw Duffel order payload — persisted on Booking.rawDuffel for audit + fallback parsing. */
  rawDuffel: Record<string, unknown> | null;
}

/**
 * Phase A.4 boundary: reject placeholder contact details before they
 * reach Duffel. Without this gate, the airline's reservation system
 * emails / SMSs a fake address and the carrier-side IROPS / schedule-
 * change comms never reach the traveler. Failing closed forces the
 * upstream tool (`book_flight`) to collect a real email + phone first.
 */
const PLACEHOLDER_EMAIL_DOMAINS = ['sendero.demo', 'whatsapp-provisional.sendero.travel'];
const PLACEHOLDER_PHONE_NUMBERS = ['+447123456789', '447123456789'];

export class DuffelContactPlaceholderError extends Error {
  constructor(
    public readonly field: 'email' | 'phone_number',
    public readonly value: string
  ) {
    super(
      `Placeholder ${field} '${value}' is not allowed at the Duffel boundary. ` +
        'The airline emails this address directly — collect a real value before booking.'
    );
    this.name = 'DuffelContactPlaceholderError';
  }
}

function assertRealEmail(email: string): void {
  const lower = email.toLowerCase().trim();
  if (!lower) throw new DuffelContactPlaceholderError('email', email);
  for (const domain of PLACEHOLDER_EMAIL_DOMAINS) {
    if (lower.endsWith(`@${domain}`)) {
      throw new DuffelContactPlaceholderError('email', email);
    }
  }
}

function assertRealPhone(phone: string | null | undefined): string {
  const trimmed = (phone ?? '').trim();
  if (!trimmed) throw new DuffelContactPlaceholderError('phone_number', '');
  for (const placeholder of PLACEHOLDER_PHONE_NUMBERS) {
    if (trimmed === placeholder) {
      throw new DuffelContactPlaceholderError('phone_number', trimmed);
    }
  }
  return trimmed;
}

export async function createHoldOrder(params: HoldOrderParams): Promise<HoldOrderResult> {
  const duffel = getDuffel();

  assertRealEmail(params.passengerEmail);
  const passengerPhone = assertRealPhone(params.passengerPhone);

  // Duffel requires a passenger ID that matches the offer's passenger ID.
  const offerResp = await duffel.offers.get(params.offerId);
  const offer = offerResp.data as unknown as DuffelOfferWireMinimal;
  const passengerId = offer.passengers?.[0]?.id || 'pax_0001';

  const [givenName, ...rest] = params.passengerName.split(' ');
  const familyName = rest.join(' ') || 'Traveler';

  const primaryCustomerUserId = params.customerUserIds?.[0] as DuffelCustomerUserId | undefined;

  // Phase D — attach identity document when the traveler's PassportVault
  // has been populated. The agent-side flow runs `scan_passport_inline`
  // before book_flight when the corridor is international + the vault
  // is empty; book_flight reads + decrypts on the fly + passes here.
  const identityDocuments = params.identityDocument
    ? [
        {
          type: params.identityDocument.type,
          unique_identifier: params.identityDocument.uniqueIdentifier,
          issuing_country_code: params.identityDocument.issuingCountryCode,
          ...(params.identityDocument.nationality
            ? { nationality: params.identityDocument.nationality }
            : {}),
          expires_on: params.identityDocument.expiresOn,
          ...(params.identityDocument.issuedOn
            ? { issued_on: params.identityDocument.issuedOn }
            : {}),
        },
      ]
    : undefined;

  const order: DuffelCreateOrderWire = {
    selected_offers: [params.offerId as DuffelCreateOrderWire['selected_offers'][number]],
    type: 'hold',
    passengers: [
      {
        id: passengerId,
        given_name: givenName || 'Guest',
        family_name: familyName,
        email: params.passengerEmail,
        phone_number: passengerPhone,
        born_on: params.passengerDob || '1990-01-01',
        gender: params.passengerGender === 'female' ? 'f' : 'm',
        title: 'mr',
        type: 'adult',
        ...(primaryCustomerUserId ? { user_id: primaryCustomerUserId } : {}),
        ...(identityDocuments ? { identity_documents: identityDocuments } : {}),
      },
    ],
    metadata: { idempotency_key: params.idempotencyKey },
  };
  if (params.customerUserIds?.length) {
    order.users = params.customerUserIds as DuffelCustomerUserId[];
  }
  if (params.services?.length) {
    order.services = params.services.map(s => ({
      id: s.id as DuffelServiceId,
      quantity: s.quantity,
    }));
  }

  // Raw fetch instead of `duffel.orders.create(order)` because the SDK
  // (v4.24) doesn't expose custom HTTP headers. Duffel uses the
  // `Idempotency-Key` request header (NOT the body-level
  // `metadata.idempotency_key`) to dedupe POST /air/orders. Without
  // the header, a retry creates a second order. book_trip relies on
  // this for its hold-phase retry semantics.
  // https://duffel.com/docs/api/overview/idempotency
  const token = env.duffelApiToken();
  if (!token) throw new Error('DUFFEL_API_TOKEN not set.');
  const orderRes = await fetch('https://api.duffel.com/air/orders', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip',
      'Content-Type': 'application/json',
      'Duffel-Version': 'v2',
      'Idempotency-Key': params.idempotencyKey,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ data: order }),
  });
  if (!orderRes.ok) {
    const rawBody = await orderRes.text();
    // Log raw body internally with redaction; surface a sanitized message
    // upstream so supplier-internal text doesn't reach the agent / customer.
    console.warn('[duffel] orders.create failed', {
      status: orderRes.status,
      offerId: params.offerId,
      bodyPreview: rawBody.slice(0, 200),
    });
    throw new Error(
      `duffel.orders.create failed (HTTP ${orderRes.status}). Check server logs for supplier-side detail.`
    );
  }
  const response = (await orderRes.json()) as {
    data: {
      id: string;
      booking_reference: string;
      total_amount: string;
      total_currency: string;
      payment_status?: { payment_required_by?: string };
    };
  };
  const orderData = response.data;

  // Project the offer's slices into Sendero's normalized segment shape.
  // We use the offer (not the order response) because Duffel orders in
  // sandbox don't always echo back slice metadata, but the offer always
  // carries it. The order's raw payload is still kept for audit on
  // `Booking.rawDuffel`.
  const segmentProjection = projectOfferSegments(offer);
  const orderRaw = response.data as unknown as Record<string, unknown>;

  return {
    orderId: orderData.id,
    bookingReference: orderData.booking_reference,
    totalAmount: orderData.total_amount,
    totalCurrency: orderData.total_currency,
    paymentRequiredBy: orderData.payment_status?.payment_required_by || '',
    services: params.services ?? [],
    segments: segmentProjection.segments,
    originIata: segmentProjection.originIata,
    destinationIata: segmentProjection.destinationIata,
    destinationIso2: segmentProjection.destinationIso2,
    startDate: segmentProjection.startDate,
    endDate: segmentProjection.endDate,
    rawDuffel: orderRaw,
  };
}

/**
 * Project a Duffel offer's `slices[].segments[]` into Sendero's
 * normalized `NormalizedFlightSegment[]` plus trip-level fields
 * (origin/destination/dates/ISO-2). Defensive against missing fields
 * in sandbox responses.
 */
/**
 * Phase D — peek at an offer's origin + destination ISO-2 country
 * codes WITHOUT creating a hold. `book_flight` calls this before
 * `createHoldOrder` so it can short-circuit on international trips
 * with a missing passport and never burn the Duffel hold quota.
 */
export async function getOfferOriginDestinationIso2(offerId: string): Promise<{
  originCountryAlpha2: string | null;
  destinationCountryAlpha2: string | null;
  isInternational: boolean;
}> {
  const duffel = getDuffel();
  const offerResp = await duffel.offers.get(offerId);
  const offer = offerResp.data as unknown as DuffelOfferWireMinimal;
  const projected = projectOfferSegments(offer);
  const first = projected.segments[0];
  const last = projected.segments[projected.segments.length - 1];
  // For round-trip (origin→A→origin), `last.destinationCountry` equals
  // origin. The "international" check is: any segment whose destination
  // differs from the origin country.
  const originCountry = first?.originCountry ?? null;
  const outboundDestCountry =
    projected.segments.find(
      s =>
        s.destinationCountry &&
        originCountry &&
        s.destinationCountry.toUpperCase() !== originCountry.toUpperCase()
    )?.destinationCountry ??
    last?.destinationCountry ??
    null;
  const isInternational = Boolean(
    originCountry &&
      outboundDestCountry &&
      originCountry.toUpperCase() !== outboundDestCountry.toUpperCase()
  );
  return {
    originCountryAlpha2: originCountry,
    destinationCountryAlpha2: outboundDestCountry,
    isInternational,
  };
}

/**
 * Peek at an offer's slice segment shape without creating a Duffel
 * hold order. Used by `book_trip` to pre-validate route continuity
 * and min-layover BEFORE phase-1 `createHoldOrder` — Codex review
 * caught that the post-hold check was burning Duffel hold quota
 * whenever a bad combo slipped through.
 *
 * Returns the first-segment departure + last-segment arrival of the
 * offer's outbound slice, plus origin/destination IATA. Returns
 * nulls when the offer payload is missing slice/segment data
 * (defensive — real Duffel offers always carry slices).
 */
export async function peekOfferSegments(offerId: string): Promise<{
  offerId: string;
  originIata: string | null;
  destinationIata: string | null;
  departureAt: string | null;
  arrivalAt: string | null;
  segments: NormalizedFlightSegment[];
}> {
  const duffel = getDuffel();
  const offerResp = await duffel.offers.get(offerId);
  const offer = offerResp.data as unknown as DuffelOfferWireMinimal;
  const projected = projectOfferSegments(offer);
  const first = projected.segments[0];
  const last = projected.segments[projected.segments.length - 1];
  return {
    offerId,
    originIata: projected.originIata,
    destinationIata: projected.destinationIata,
    departureAt: first?.departureAt ?? null,
    arrivalAt: last?.arrivalAt ?? null,
    segments: projected.segments,
  };
}

/**
 * Project a Duffel offer OR order payload's `slices[*].segments[*]`
 * into Sendero's normalized shape. Exported so callers that bypass
 * `createHoldOrder` (the re-pay path in `book_flight` after an
 * insufficient_funds top-up) can backfill `Booking.segments` from the
 * already-fetched order payload without round-tripping to the offer.
 */
export function projectFlightSegmentsFromPayload(
  payload: Record<string, unknown> | DuffelOfferWireMinimal
): {
  segments: NormalizedFlightSegment[];
  originIata: string | null;
  destinationIata: string | null;
  destinationIso2: string[];
  startDate: string | null;
  endDate: string | null;
} {
  return projectOfferSegments(payload as DuffelOfferWireMinimal);
}

function projectOfferSegments(offer: DuffelOfferWireMinimal): {
  segments: NormalizedFlightSegment[];
  originIata: string | null;
  destinationIata: string | null;
  destinationIso2: string[];
  startDate: string | null;
  endDate: string | null;
} {
  const slicesRaw = (offer as unknown as { slices?: unknown }).slices;
  const slices: Array<Record<string, unknown>> = Array.isArray(slicesRaw)
    ? (slicesRaw as Array<Record<string, unknown>>)
    : [];

  const segments: NormalizedFlightSegment[] = [];
  const iso2Set = new Set<string>();

  for (const slice of slices) {
    const segs = Array.isArray(slice.segments)
      ? (slice.segments as Array<Record<string, unknown>>)
      : [];
    for (const seg of segs) {
      const origin = (seg.origin ?? {}) as Record<string, unknown>;
      const destination = (seg.destination ?? {}) as Record<string, unknown>;
      const operating = (seg.operating_carrier ?? {}) as Record<string, unknown>;
      const marketing = (seg.marketing_carrier ?? {}) as Record<string, unknown>;
      const carrierName = strOr(marketing.name, operating.name);
      const carrierIata = strOr(marketing.iata_code, operating.iata_code);
      const flightNumberSuffix = strOr(
        seg.marketing_carrier_flight_number,
        seg.operating_carrier_flight_number
      );
      const flightNumber =
        carrierIata && flightNumberSuffix ? `${carrierIata}${flightNumberSuffix}` : null;
      const passengers = Array.isArray(seg.passengers)
        ? (seg.passengers as Array<Record<string, unknown>>)
        : [];
      const cabin = strOr(passengers[0]?.cabin_class, slice.fare_brand_name) ?? null;

      const originIata = strOr(origin.iata_code) ?? '';
      const destinationIata = strOr(destination.iata_code) ?? '';
      const originCountry = strOr(origin.iata_country_code, origin.country_code);
      const destinationCountry = strOr(destination.iata_country_code, destination.country_code);
      if (destinationCountry && /^[A-Za-z]{2}$/.test(destinationCountry)) {
        iso2Set.add(destinationCountry.toUpperCase());
      }

      const durationStr = strOr(seg.duration);
      const durationMinutes = durationStr ? parseIso8601DurationMinutes(durationStr) : null;

      segments.push({
        originIata,
        destinationIata,
        originCity: strOr(origin.city_name, origin.name),
        destinationCity: strOr(destination.city_name, destination.name),
        originCountry,
        destinationCountry,
        carrier: carrierIata,
        carrierName,
        flightNumber,
        cabin,
        departureAt: strOr(seg.departing_at),
        arrivalAt: strOr(seg.arriving_at),
        durationMinutes,
      });
    }
  }

  const first = segments[0];
  const last = segments[segments.length - 1];
  const startDate = first?.departureAt ? first.departureAt.slice(0, 10) : null;
  const endDate = last?.arrivalAt ? last.arrivalAt.slice(0, 10) : null;

  return {
    segments,
    originIata: first?.originIata ?? null,
    destinationIata: last?.destinationIata ?? null,
    destinationIso2: [...iso2Set],
    startDate,
    endDate,
  };
}

function strOr(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim().length > 0) return v;
  }
  return null;
}

/** Parse ISO 8601 durations like `PT4H47M` → minutes. Returns null on garbage input. */
function parseIso8601DurationMinutes(d: string): number | null {
  const match = d.match(/^PT(?:(\d+)H)?(?:(\d+)M)?$/);
  if (!match) return null;
  const hours = match[1] ? Number.parseInt(match[1], 10) : 0;
  const mins = match[2] ? Number.parseInt(match[2], 10) : 0;
  if (Number.isNaN(hours) || Number.isNaN(mins)) return null;
  return hours * 60 + mins;
}

export interface PayFromBalanceResult {
  paymentId: string;
  status: string;
  amount: string;
  currency: string;
}

export async function payFromBalance(
  orderId: string,
  options?: { idempotencyKey?: string }
): Promise<PayFromBalanceResult> {
  const duffel = getDuffel();

  // Fetch latest price before paying (Duffel best practice).
  const latest = await duffel.orders.get(orderId);
  const totalAmount = latest.data.total_amount;
  const totalCurrency = latest.data.total_currency;

  // Raw fetch (instead of `duffel.payments.create`) so we can attach the
  // `Idempotency-Key` request header — the SDK doesn't expose custom
  // headers. Without idempotency a retry pays twice; book_trip relies
  // on this for partial-paid recovery.
  // https://duffel.com/docs/api/overview/idempotency
  const token = env.duffelApiToken();
  if (!token) throw new Error('DUFFEL_API_TOKEN not set.');
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Accept-Encoding': 'gzip',
    'Content-Type': 'application/json',
    'Duffel-Version': 'v2',
    Authorization: `Bearer ${token}`,
  };
  if (options?.idempotencyKey) {
    headers['Idempotency-Key'] = options.idempotencyKey;
  }
  const payRes = await fetch('https://api.duffel.com/air/payments', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      data: {
        order_id: orderId,
        payment: {
          type: 'balance',
          amount: totalAmount,
          currency: totalCurrency,
        },
      },
    }),
  });
  if (!payRes.ok) {
    const rawBody = await payRes.text();
    console.warn('[duffel] payments.create failed', {
      status: payRes.status,
      orderId,
      bodyPreview: rawBody.slice(0, 200),
    });
    throw new Error(
      `duffel.payments.create failed (HTTP ${payRes.status}). Check server logs for supplier-side detail.`
    );
  }
  const response = (await payRes.json()) as { data: Payment };
  const paymentData = response.data;

  return {
    paymentId: paymentData.id,
    // Balance payments always succeed synchronously per Duffel docs.
    status: 'succeeded',
    amount: totalAmount,
    currency: totalCurrency,
  };
}

export async function getOrder(orderId: string) {
  const duffel = getDuffel();
  const r = await duffel.orders.get(orderId);
  return r.data;
}

/**
 * Carrier-issued e-ticket document. Returned by Duffel's
 * `GET /air/orders/{orderId}/documents` after fulfilment. The
 * `electronic_ticket` type is the airline-issued e-ticket that the
 * post-ticketing fan-out attaches to email + ships via WhatsApp
 * `send_document_message`. Other document types (`itinerary_receipt`,
 * `electronic_miscellaneous_document_associated`,
 * `electronic_miscellaneous_document_standalone`) appear in passport
 * checks and ancillaries; we surface them all so callers can pick.
 */
export interface DuffelOrderDocument {
  type: string;
  /** Public PDF URL — Duffel hosts this. */
  url: string;
  unique_identifier: string;
}

/**
 * Fetch the airline-issued documents for a ticketed Duffel order.
 * Returns an empty array when the supplier hasn't issued any (sandbox
 * carriers often skip e-ticket emission for instant-pay flows). The
 * caller is responsible for picking `type === 'electronic_ticket'`
 * for the canonical e-ticket PDF.
 *
 * Reference: https://duffel.com/docs/api/orders/get-order-documents
 */
export async function getOrderDocuments(orderId: string): Promise<DuffelOrderDocument[]> {
  const duffel = getDuffel();
  // The Duffel SDK doesn't (yet) expose a typed `orders.documents.list`.
  // The HTTP client is reachable via `duffel.client` — fall back to
  // `duffel.orders.get(orderId)` and read the `documents` array off the
  // order payload, which is where Duffel returns them inline as of API
  // version `v2`. This avoids a second round-trip + a custom client
  // call when most callers fetched the order anyway.
  const order = await duffel.orders.get(orderId);
  const data = order.data as unknown as { documents?: DuffelOrderDocument[] };
  if (!Array.isArray(data.documents)) return [];
  return data.documents.filter(
    d => d && typeof d === 'object' && typeof d.url === 'string' && typeof d.type === 'string'
  );
}

/**
 * Convenience: pick the airline-issued electronic_ticket document
 * from a Duffel order. Returns null when no `electronic_ticket` type
 * is present (sandbox + some code-share supplier paths).
 */
export async function getOrderEticket(orderId: string): Promise<DuffelOrderDocument | null> {
  const docs = await getOrderDocuments(orderId);
  return docs.find(d => d.type === 'electronic_ticket') ?? null;
}

/**
 * Per-leg online check-in link as exposed by the airline. Duffel surfaces
 * this on `order.slices[].segments[].online_check_in_link` once the
 * carrier has made web check-in available — typically T-24h before
 * departure, sometimes T-48h. Sandbox carriers + code-share legs return
 * `null`. Sendero's T-24h cron falls back to a carrier-specific lookup
 * map when the field is absent.
 */
export interface OnlineCheckInLink {
  segmentId: string;
  carrierIata: string;
  carrierName: string;
  url: string | null;
  departingAt: string | null;
  originIata: string | null;
  destinationIata: string | null;
}

/**
 * Fallback check-in deep links for carriers Sendero books most often.
 * Used when Duffel hasn't (yet) populated `online_check_in_link` on the
 * segment — sandbox carriers + carriers that haven't onboarded the
 * field. Traveler enters PNR + last name on the airline's page.
 */
const CARRIER_CHECKIN_FALLBACK: Record<string, string> = {
  LA: 'https://www.latamairlines.com/check-in',
  AR: 'https://www.aerolineas.com.ar/checkin',
  AV: 'https://www.avianca.com/check-in',
  CM: 'https://www.copaair.com/web-checkin',
  AM: 'https://aeromexico.com/check-in',
  G3: 'https://www.voegol.com.br/check-in',
  AD: 'https://www.voeazul.com.br/check-in',
  AA: 'https://www.aa.com/checkin',
  DL: 'https://www.delta.com/check-in',
  UA: 'https://www.united.com/checkin',
  IB: 'https://www.iberia.com/check-in/',
  AF: 'https://www.airfrance.com/check-in',
  BA: 'https://www.britishairways.com/travel/managebooking/public/en_gb',
  LH: 'https://www.lufthansa.com/check-in',
  // Duffel sandbox — no real check-in URL. Empty string flags it as
  // sandbox so the renderer can show a hint instead of a broken link.
  ZZ: '',
};

/**
 * Fetch per-leg online check-in links for a Duffel order. Reads the
 * segment-level `online_check_in_link` when Duffel has populated it,
 * else falls back to the carrier deep link from
 * `CARRIER_CHECKIN_FALLBACK`. Returns `[]` for orders Duffel hasn't
 * resolved yet (rare; the cron retries hourly).
 *
 * Reference: Duffel order schema → slices[].segments[].online_check_in_link
 */
export async function getOrderOnlineCheckInLinks(orderId: string): Promise<OnlineCheckInLink[]> {
  const duffel = getDuffel();
  const order = await duffel.orders.get(orderId);
  const data = order.data as unknown as {
    slices?: Array<{
      segments?: Array<{
        id?: string;
        online_check_in_link?: string | null;
        marketing_carrier?: { iata_code?: string; name?: string };
        operating_carrier?: { iata_code?: string; name?: string };
        departing_at?: string;
        origin?: { iata_code?: string };
        destination?: { iata_code?: string };
      }>;
    }>;
  };
  const links: OnlineCheckInLink[] = [];
  for (const slice of data.slices ?? []) {
    for (const seg of slice.segments ?? []) {
      const carrierIata =
        seg.marketing_carrier?.iata_code ?? seg.operating_carrier?.iata_code ?? '';
      const carrierName = seg.marketing_carrier?.name ?? seg.operating_carrier?.name ?? carrierIata;
      const fallback = CARRIER_CHECKIN_FALLBACK[carrierIata.toUpperCase()];
      const url =
        typeof seg.online_check_in_link === 'string' && seg.online_check_in_link.length > 0
          ? seg.online_check_in_link
          : fallback && fallback.length > 0
            ? fallback
            : null;
      links.push({
        segmentId: seg.id ?? '',
        carrierIata,
        carrierName,
        url,
        departingAt: seg.departing_at ?? null,
        originIata: seg.origin?.iata_code ?? null,
        destinationIata: seg.destination?.iata_code ?? null,
      });
    }
  }
  return links;
}

// ============================================================================
// Stays (hotels)
// ============================================================================

export interface HotelSearchParams {
  /**
   * Raw `lat,lng` string — Duffel Stays only accepts coordinates. The
   * tool layer is responsible for geocoding free-form input upstream
   * (see `@sendero/tools/lib/resolve-stay-location`). Passing a city
   * name here throws — we used to silently fall back to London, which
   * mis-located every Lima / Cusco / São Paulo / Bogotá / Quito query.
   */
  location: string;
  checkInDate: string;
  checkOutDate: string;
  guests?: number;
  rooms?: number;
  /** Search radius in km (default 5). */
  radiusKm?: number;
}

const COORDS_RE = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/;

function parseCoords(loc: string): { lat: number; lng: number } {
  const m = loc.match(COORDS_RE);
  if (!m) {
    throw new Error(
      `searchHotels expects "lat,lng" — got "${loc}". Geocode upstream via @sendero/tools/lib/resolve-stay-location before calling this wrapper. The hand-rolled city dictionary + London fallback was removed because it mis-located every city not in the (small) hardcoded list.`
    );
  }
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!Number.isFinite(lat) || Math.abs(lat) > 90) {
    throw new Error(`searchHotels: latitude out of range (got ${lat}).`);
  }
  if (!Number.isFinite(lng) || Math.abs(lng) > 180) {
    throw new Error(`searchHotels: longitude out of range (got ${lng}).`);
  }
  return { lat, lng };
}

export interface HotelOfferSummary {
  /** Quote/search-result ID — used for later booking. */
  id: string;
  name: string;
  city: string | null;
  country: string | null;
  stars: number | null;
  reviewScore: number | null;
  /** Up to 3 photo URLs from Duffel's CDN. */
  photos: string[];
  /** Primary (cheapest) rate per the Stays response. */
  price: string;
  currency: string;
  /** Cancellation timeline summary, if present. */
  cancellation: 'free' | 'partial' | 'non_refundable' | 'unknown';
  /** Distance from the searched location, in meters, if provided. */
  distanceMeters: number | null;
  amenities: string[];
}

/**
 * Derive a coarse cancellation label for a single hotel offer summary.
 *
 * Per-rate cancellation timelines only appear when the caller fetched
 * the search result with `searchResults.fetchAllRates` — the Duffel
 * list-search response carries `cheapest_rate_*` summaries only and
 * leaves `accommodation.rooms[].rates` empty. The bug this replaces
 * walked `r.rates` (always empty), so every offer was incorrectly
 * tagged 'unknown' or 'partial'. Now: walk the right path; report
 * 'unknown' when the data isn't there.
 */
export function deriveStayCancellation(
  rooms: Array<{
    rates?: Array<{
      total_amount: string;
      cancellation_timeline?: Array<{ refund_amount: string }>;
    }>;
  }>
): HotelOfferSummary['cancellation'] {
  const flatRates = rooms.flatMap(rm => rm.rates ?? []);
  if (!flatRates.length) return 'unknown';
  const hasFullRefund = flatRates.some(rate =>
    rate.cancellation_timeline?.some(
      c => parseFloat(c.refund_amount) >= parseFloat(rate.total_amount)
    )
  );
  if (hasFullRefund) return 'free';
  const hasAnyTimeline = flatRates.some(rate => (rate.cancellation_timeline?.length ?? 0) > 0);
  return hasAnyTimeline ? 'partial' : 'non_refundable';
}

/**
 * Search hotels via Duffel Stays API.
 * Returns the top 6 accommodations ranked by Duffel's default ordering,
 * each with real photos + the cheapest available rate.
 */
export async function searchHotels(params: HotelSearchParams): Promise<HotelOfferSummary[]> {
  const duffel = getDuffel();
  const coords = parseCoords(params.location);
  const radiusKm = params.radiusKm ?? 5;

  /**
   * The list-search response only carries `cheapest_rate_*` summary fields —
   * full per-rate detail (cancellation_timeline, payment_type, room name) lives
   * under `accommodation.rooms[].rates[]` only when the caller fetches by id
   * via `searchResults.fetchAllRates`. The SDK types omit `rooms` on the
   * accommodation; we widen here for the cancellation derivation.
   */
  type StaysLocationExtended = {
    address?: { city_name?: string; country_code?: string };
    /** Not in SDK StaysLocation but present in raw API for some search results. */
    distance_meters?: number | null;
  };
  type StaysSearchResultExtended = StaysSearchResult & {
    accommodation: StaysSearchResult['accommodation'] & {
      rooms?: Array<{
        name?: string;
        rates?: Array<{
          total_amount: string;
          cancellation_timeline?: Array<{ refund_amount: string }>;
        }>;
      }>;
    };
  };

  let response: Awaited<ReturnType<typeof duffel.stays.search>>;
  try {
    response = await duffel.stays.search({
      location: {
        radius: radiusKm,
        geographic_coordinates: {
          latitude: coords.lat,
          longitude: coords.lng,
        },
      },
      check_in_date: params.checkInDate,
      check_out_date: params.checkOutDate,
      rooms: params.rooms ?? 1,
      guests: Array.from({ length: params.guests ?? 1 }, (): Guest => ({ type: 'adult' })),
    });
  } catch (err: unknown) {
    // Duffel Stays is an opt-in product — most sandbox tokens don't have
    // it enabled. Surface a useful, actionable error instead of "unknown".
    const anyErr = err as Record<string, unknown>;
    console.error('[stays] raw error:', {
      name: anyErr?.name,
      code: anyErr?.code,
      statusCode:
        (anyErr?.statusCode as number | undefined) ??
        (anyErr?.meta as Record<string, unknown> | undefined)?.status,
      meta: anyErr?.meta,
      errors: anyErr?.errors,
      message: anyErr?.message,
    });
    const errs = anyErr?.errors as Array<Record<string, unknown>> | undefined;
    const metaErrs = (anyErr?.meta as Record<string, unknown> | undefined)?.errors as
      | Array<Record<string, unknown>>
      | undefined;
    const firstDuffel = errs?.[0] ?? metaErrs?.[0];
    if (firstDuffel) {
      throw new Error(
        firstDuffel.title
          ? `${String(firstDuffel.title)}: ${String(firstDuffel.message ?? firstDuffel.detail ?? '')}`.trim()
          : String(firstDuffel.message ?? JSON.stringify(firstDuffel))
      );
    }
    if (anyErr?.message) {
      throw new Error(
        `Duffel Stays request failed (${String(anyErr.name ?? 'Error')}): ${String(anyErr.message)}. Most sandbox tokens don't have Stays enabled — contact Duffel to turn it on.`
      );
    }
    throw new Error(
      'Duffel Stays request failed. This product is opt-in; the sandbox token likely does not have Stays enabled.'
    );
  }

  const searchResponse: StaysSearchResponse = response.data;
  const results = (searchResponse?.results ?? []).slice(0, 6) as StaysSearchResultExtended[];

  return results.map((r: StaysSearchResultExtended): HotelOfferSummary => {
    const acc = r.accommodation;
    const cheapest = r.cheapest_rate_total_amount ?? null;
    const currency = r.cheapest_rate_currency ?? 'USD';
    const photos = (acc.photos ?? [])
      .map(p => p?.url)
      .filter(Boolean)
      .slice(0, 3);
    const loc = acc.location as StaysLocationExtended;
    const cancellation = deriveStayCancellation(acc.rooms ?? []);

    return {
      id: r.id,
      name: acc.name ?? 'Unknown property',
      city: loc?.address?.city_name ?? null,
      country: loc?.address?.country_code ?? null,
      stars: acc.rating ?? null,
      reviewScore: acc.review_score ?? null,
      photos,
      price: cheapest ?? '0',
      currency,
      cancellation,
      distanceMeters: loc?.distance_meters ?? null,
      amenities: (acc.amenities ?? [])
        .map(a => a?.type)
        .filter(Boolean)
        .slice(0, 5),
    };
  });
}

export interface StayRateSummary {
  /** Rate id (`rat_…`) — pass to `createStayQuote`. */
  rateId: string;
  roomName: string | null;
  /** Full billing breakdown, separated. Duffel Go-Live mandates rendering
   *  base / tax / fee / due-at-property without summing on our side. */
  baseAmount: string | null;
  baseCurrency: string | null;
  taxAmount: string;
  taxCurrency: string;
  feeAmount: string;
  feeCurrency: string;
  totalAmount: string;
  totalCurrency: string;
  /** Always set; "0" when Duffel returns null. */
  dueAtAccommodationAmount: string;
  dueAtAccommodationCurrency: string;
  /** `pay_now` | `deposit` | `guarantee`, when supplied by Duffel. */
  paymentType: string | null;
  /** Card / balance methods Duffel will accept on this rate. */
  availablePaymentMethods: string[];
  /** True iff cancellation_timeline has at least one entry. */
  refundable: boolean;
  /** Inline cancellation timeline, when present. */
  cancellationTimeline: Array<{ before: string; refund_amount: string; currency: string }>;
  /** "room_only" | "breakfast" | "half_board" | "full_board" | "all_inclusive". */
  boardType: string | null;
}

export interface StayRatesResult {
  /** Search-result id passed in. */
  searchResultId: string;
  hotelName: string;
  /** ISO-2 country code from Duffel. */
  country: string | null;
  city: string | null;
  /** Earliest check-in time the property accepts (e.g. "14:30"). */
  checkInAfter: string | null;
  checkOutBefore: string | null;
  /** Free-form key-collection instructions. Duffel mandates we surface this. */
  keyCollection: string | null;
  rates: StayRateSummary[];
}

/**
 * Fetch the full rate matrix (rooms × rates) for a Duffel Stays search
 * result. The list search only returns `cheapest_rate_*` summaries, so
 * the agent must call this before quoting — only this endpoint hands
 * back rate ids and per-rate cancellation timelines.
 *
 * https://duffel.com/docs/api/v2/stays-search-results/get-stays-search-result-rates
 */
export async function listStayRates(searchResultId: string): Promise<StayRatesResult> {
  const duffel = getDuffel();
  const stays = duffel.stays as unknown as {
    searchResults: {
      fetchAllRates: (id: string) => Promise<{ data: unknown }>;
    };
  };
  const r = await stays.searchResults.fetchAllRates(searchResultId);
  type Room = {
    name?: string;
    rates?: Array<{
      id: string;
      total_amount: string;
      total_currency: string;
      base_amount?: string | null;
      base_currency?: string | null;
      tax_amount?: string | null;
      tax_currency?: string | null;
      fee_amount?: string | null;
      fee_currency?: string | null;
      due_at_accommodation_amount?: string | null;
      due_at_accommodation_currency?: string | null;
      payment_type?: string;
      available_payment_methods?: string[];
      cancellation_timeline?: Array<{ before: string; refund_amount: string; currency: string }>;
      board_type?: string;
    }>;
  };
  type AccommodationLite = {
    name?: string;
    location?: { address?: { city_name?: string; country_code?: string } };
    check_in_information?: { check_in_after_time?: string; check_out_before_time?: string };
    key_collection?: { instructions?: string };
    rooms?: Room[];
  };
  type Result = { id: string; accommodation: AccommodationLite };
  const result = r.data as Result;
  const acc = result.accommodation;
  const rooms = acc.rooms ?? [];
  const rates: StayRateSummary[] = rooms.flatMap(rm =>
    (rm.rates ?? []).map(rt => ({
      rateId: rt.id,
      roomName: rm.name ?? null,
      baseAmount: rt.base_amount ?? null,
      baseCurrency: rt.base_currency ?? rt.total_currency,
      taxAmount: rt.tax_amount ?? '0',
      taxCurrency: rt.tax_currency ?? rt.total_currency,
      feeAmount: rt.fee_amount ?? '0',
      feeCurrency: rt.fee_currency ?? rt.total_currency,
      totalAmount: rt.total_amount,
      totalCurrency: rt.total_currency,
      dueAtAccommodationAmount: rt.due_at_accommodation_amount ?? '0',
      dueAtAccommodationCurrency: rt.due_at_accommodation_currency ?? rt.total_currency,
      paymentType: rt.payment_type ?? null,
      availablePaymentMethods: rt.available_payment_methods ?? [],
      refundable: (rt.cancellation_timeline?.length ?? 0) > 0,
      cancellationTimeline: rt.cancellation_timeline ?? [],
      boardType: rt.board_type ?? null,
    }))
  );
  return {
    searchResultId: result.id,
    hotelName: acc.name ?? 'Unknown property',
    country: acc.location?.address?.country_code ?? null,
    city: acc.location?.address?.city_name ?? null,
    checkInAfter: acc.check_in_information?.check_in_after_time ?? null,
    checkOutBefore: acc.check_in_information?.check_out_before_time ?? null,
    keyCollection: acc.key_collection?.instructions ?? null,
    rates,
  };
}

// ============================================================================
// Customer Users + Customer User Groups (Duffel identity)
//
// See https://duffel.com/docs/guides/modelling-customers — attaching a
// CustomerUser to an order unlocks the Travel Support Assistant and
// lets Duffel send confirmation + support emails.
// ============================================================================

/** Wrapper payload (camelCase-ish) that the tool layer uses. */
export interface DuffelCustomerUserPayload {
  email: string;
  given_name: string;
  family_name: string;
  phone_number?: string;
  group_id?: DuffelCustomerUserId | string;
  /** Accepted by REST; not in SDK type as of @duffel/api v4.24. */
  preferred_language?: string;
}

export type DuffelCustomerUser = DuffelCustomerUserWire;
export type DuffelCustomerUserGroup = DuffelCustomerUserGroupWire;

function toWireCustomerUserPayload(p: DuffelCustomerUserPayload): DuffelCustomerUserPayloadWire {
  return {
    email: p.email,
    given_name: p.given_name,
    family_name: p.family_name,
    phone_number: p.phone_number ?? null,
    group_id: (p.group_id as DuffelCustomerUserPayloadWire['group_id']) ?? null,
    preferred_language: p.preferred_language ?? null,
  };
}

/**
 * The @duffel/api SDK's TS signatures for `identity.customerUsers.*` don't
 * include `preferred_language` and typecast payloads narrowly. We bridge
 * through `unknown` + our wire type so callers stay strictly typed.
 */
export async function createCustomerUser(
  payload: DuffelCustomerUserPayload
): Promise<DuffelCustomerUser> {
  const duffel = getDuffel();
  const r = await duffel.identity.customerUsers.create(
    toWireCustomerUserPayload(payload) as unknown as Parameters<
      typeof duffel.identity.customerUsers.create
    >[0]
  );
  return r.data as unknown as DuffelCustomerUser;
}

export async function getCustomerUser(
  id: DuffelCustomerUserId | string
): Promise<DuffelCustomerUser> {
  const duffel = getDuffel();
  const r = await duffel.identity.customerUsers.get(id);
  return r.data as unknown as DuffelCustomerUser;
}

export async function updateCustomerUser(
  id: DuffelCustomerUserId | string,
  payload: DuffelCustomerUserPayload
): Promise<DuffelCustomerUser> {
  const duffel = getDuffel();
  const r = await duffel.identity.customerUsers.update(
    id,
    toWireCustomerUserPayload(payload) as unknown as Parameters<
      typeof duffel.identity.customerUsers.update
    >[1]
  );
  return r.data as unknown as DuffelCustomerUser;
}

export async function findCustomerUserByEmail(email: string): Promise<DuffelCustomerUser | null> {
  const duffel = getDuffel();
  const r = await duffel.identity.customerUsers.list({ email } as unknown as Parameters<
    typeof duffel.identity.customerUsers.list
  >[0]);
  const list = r.data as unknown as DuffelCustomerUserWire[];
  return list[0] ?? null;
}

export async function createCustomerUserGroup(args: {
  name: string;
  userIds?: DuffelCustomerUserId[];
}): Promise<DuffelCustomerUserGroup> {
  const duffel = getDuffel();
  const wire: DuffelCustomerUserGroupPayloadWire = {
    name: args.name,
    user_ids: args.userIds ?? [],
  };
  const r = await duffel.identity.customerUserGroups.create(
    wire as unknown as Parameters<typeof duffel.identity.customerUserGroups.create>[0]
  );
  return r.data as unknown as DuffelCustomerUserGroup;
}

export async function getCustomerUserGroup(id: string): Promise<DuffelCustomerUserGroup> {
  const duffel = getDuffel();
  const r = await duffel.identity.customerUserGroups.get(id);
  return r.data as unknown as DuffelCustomerUserGroup;
}

// ============================================================================
// Ancillary services — baggage, CFAR, seats
// ============================================================================

export type DuffelAncillaryType = 'baggage' | 'cancel_for_any_reason';

export interface DuffelAvailableServiceBaggage {
  id: string;
  type: 'baggage';
  maximumQuantity: number;
  passengerIds: string[];
  segmentIds: string[];
  totalAmount: string;
  totalCurrency: string;
  metadata: {
    kind?: 'carry_on' | 'checked';
    maxWeightKg?: number | null;
    maxHeightCm?: number | null;
    maxLengthCm?: number | null;
    maxDepthCm?: number | null;
  };
}

export interface DuffelAvailableServiceCFAR {
  id: string;
  type: 'cancel_for_any_reason';
  maximumQuantity: number;
  passengerIds: string[];
  segmentIds: string[];
  totalAmount: string;
  totalCurrency: string;
  metadata: {
    refundAmount?: string;
    merchantCopy?: string;
    termsAndConditionsUrl?: string;
  };
}

export type DuffelAvailableService = DuffelAvailableServiceBaggage | DuffelAvailableServiceCFAR;

function mapAvailableService(
  raw: DuffelAvailableServiceWire | null | undefined
): DuffelAvailableService | null {
  if (!raw || typeof raw !== 'object' || !raw.id || !raw.type) return null;
  const base = {
    id: String(raw.id),
    maximumQuantity: Number(raw.maximum_quantity ?? 1),
    passengerIds: Array.isArray(raw.passenger_ids) ? raw.passenger_ids.map(String) : [],
    segmentIds: Array.isArray(raw.segment_ids) ? raw.segment_ids.map(String) : [],
    totalAmount: String(raw.total_amount ?? '0'),
    totalCurrency: String(raw.total_currency ?? 'USD'),
  };
  if (raw.type === 'baggage') {
    const meta = (raw as DuffelAvailableServiceBaggageWire).metadata;
    return {
      ...base,
      type: 'baggage',
      metadata: {
        kind: meta?.type,
        maxWeightKg: meta?.maximum_weight_kg ?? null,
        maxHeightCm: meta?.maximum_height_cm ?? null,
        maxLengthCm: meta?.maximum_length_cm ?? null,
        maxDepthCm: meta?.maximum_depth_cm ?? null,
      },
    };
  }
  if (raw.type === 'cancel_for_any_reason') {
    const meta = (raw as DuffelAvailableServiceCFARWire).metadata;
    return {
      ...base,
      type: 'cancel_for_any_reason',
      metadata: {
        refundAmount: meta?.refund_amount,
        merchantCopy: meta?.merchant_copy,
        termsAndConditionsUrl: meta?.terms_and_conditions_url,
      },
    };
  }
  return null;
}

export interface DuffelSeatOption {
  serviceId: string;
  designator: string;
  name?: string;
  cabinClass?: string;
  passengerId: string;
  totalAmount: string;
  totalCurrency: string;
  disclosures: string[];
}

export interface DuffelOfferAncillaries {
  offerId: string;
  available: DuffelAvailableService[];
  seats: DuffelSeatOption[];
  currency: string;
}

export async function getOfferWithAncillaries(offerId: string): Promise<DuffelOfferAncillaries> {
  const duffel = getDuffel();
  const offer = (await duffel.offers.get(offerId)).data as unknown as DuffelOfferWireMinimal;
  const services = Array.isArray(offer.available_services) ? offer.available_services : [];
  const available = services
    .map(raw => mapAvailableService(raw as DuffelAvailableServiceWire))
    .filter((s): s is DuffelAvailableService => Boolean(s));

  let seats: DuffelSeatOption[] = [];
  try {
    const maps = (
      await duffel.seatMaps.get({ offer_id: offerId } as unknown as Parameters<
        typeof duffel.seatMaps.get
      >[0])
    ).data as unknown as DuffelSeatMapWire[];
    for (const map of maps ?? []) {
      for (const cabin of map?.cabins ?? []) {
        const cabinClass = cabin?.cabin_class;
        for (const row of cabin?.rows ?? []) {
          for (const section of row?.sections ?? []) {
            for (const el of section?.elements ?? []) {
              if (el?.type !== 'seat') continue;
              for (const svc of el?.available_services ?? []) {
                seats.push({
                  serviceId: String(svc.id),
                  designator: String(el.designator ?? ''),
                  name: el.name,
                  cabinClass,
                  passengerId: String(svc.passenger_id ?? ''),
                  totalAmount: String(svc.total_amount ?? '0'),
                  totalCurrency: String(svc.total_currency ?? 'USD'),
                  disclosures: Array.isArray(el.disclosures) ? el.disclosures : [],
                });
              }
            }
          }
        }
      }
    }
  } catch {
    // Some offer types don't expose seat maps — swallow + return empty.
    seats = [];
  }

  return {
    offerId,
    available,
    seats,
    currency: offer.total_currency ?? 'USD',
  };
}

export interface AddServicesParams {
  orderId: string;
  services: Array<{ id: DuffelServiceId | string; quantity: number }>;
  payment: { type: 'balance'; currency: string; amount: string };
}

export async function addServicesToOrder(params: AddServicesParams): Promise<unknown> {
  const duffel = getDuffel();
  const ordersWithAddServices = duffel.orders as unknown as {
    addServices: (
      orderId: string,
      body: { add_services: AddServicesParams['services']; payment: AddServicesParams['payment'] }
    ) => Promise<{ data: unknown }>;
  };
  const r = await ordersWithAddServices.addServices(params.orderId, {
    add_services: params.services,
    payment: params.payment,
  });
  return r.data;
}

// ============================================================================
// Offer conditions + private fares + airline credit availability
// ============================================================================

export interface OfferConditionsSummary {
  offerId: string;
  totalAmount: string;
  totalCurrency: string;
  conditions: DuffelConditionsWire | null;
  slices: Array<{
    sliceId: string;
    origin: string;
    destination: string;
    change_before_departure: DuffelConditionsWire['change_before_departure'];
  }>;
  privateFaresApplied: Array<{
    type: string;
    corporate_code?: string;
    tour_code?: string;
    tracking_reference?: string;
  }>;
  availableAirlineCreditIds: string[];
  supportedLoyaltyProgrammes: string[];
}

export async function getOfferConditions(offerId: string): Promise<OfferConditionsSummary> {
  const duffel = getDuffel();
  const raw = (await duffel.offers.get(offerId)).data as unknown as {
    id: string;
    total_amount: string;
    total_currency: string;
    conditions?: DuffelConditionsWire | null;
    slices?: Array<{
      id: string;
      origin?: { iata_code?: string };
      destination?: { iata_code?: string };
      conditions?: DuffelConditionsWire;
    }>;
    private_fares?: Array<{
      type: string;
      corporate_code?: string;
      tour_code?: string;
      tracking_reference?: string;
    }>;
    available_airline_credit_ids?: string[];
    supported_loyalty_programmes?: string[];
  };
  return {
    offerId: raw.id,
    totalAmount: raw.total_amount,
    totalCurrency: raw.total_currency,
    conditions: raw.conditions ?? null,
    slices: (raw.slices ?? []).map(s => ({
      sliceId: s.id,
      origin: s.origin?.iata_code ?? '',
      destination: s.destination?.iata_code ?? '',
      change_before_departure: s.conditions?.change_before_departure ?? null,
    })),
    privateFaresApplied: raw.private_fares ?? [],
    availableAirlineCreditIds: raw.available_airline_credit_ids ?? [],
    supportedLoyaltyProgrammes: raw.supported_loyalty_programmes ?? [],
  };
}

// ============================================================================
// Places suggestions (airport/city radius search)
// ============================================================================

export interface PlaceSuggestionsParams {
  /** Free-form text — airline name, city, airport code, etc. */
  query?: string;
  /** Latitude + longitude + radius in metres. `rad` ≤ 500000 (500km). */
  lat?: number;
  lng?: number;
  radMeters?: number;
}

export interface DuffelPlaceSuggestion {
  type: 'airport' | 'city' | string;
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  timeZone: string;
  iataCode?: string;
  iataCityCode?: string;
  iataCountryCode?: string;
  icaoCode?: string;
  cityName?: string;
}

function toPlaceSuggestion(raw: DuffelPlaceSuggestionWire): DuffelPlaceSuggestion {
  return {
    type: raw.type,
    id: raw.id,
    name: raw.name,
    latitude: raw.latitude,
    longitude: raw.longitude,
    timeZone: raw.time_zone,
    iataCode: raw.iata_code,
    iataCityCode: raw.iata_city_code,
    iataCountryCode: raw.iata_country_code,
    icaoCode: raw.icao_code,
    cityName: raw.city_name,
  };
}

export async function duffelPlaceSuggestions(
  params: PlaceSuggestionsParams
): Promise<DuffelPlaceSuggestion[]> {
  const token = env.duffelApiToken();
  if (!token) throw new Error('DUFFEL_API_TOKEN not set.');
  const qs = new URLSearchParams();
  if (params.query) qs.set('query', params.query);
  if (typeof params.lat === 'number') qs.set('lat', String(params.lat));
  if (typeof params.lng === 'number') qs.set('lng', String(params.lng));
  if (typeof params.radMeters === 'number') qs.set('rad', String(params.radMeters));
  const res = await fetch(`https://api.duffel.com/places/suggestions?${qs.toString()}`, {
    headers: {
      Accept: 'application/json',
      'Duffel-Version': 'v2',
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`duffel.places.suggestions ${res.status}: ${body.slice(0, 400)}`);
  }
  const json = (await res.json()) as { data?: DuffelPlaceSuggestionWire[] };
  return (json.data ?? []).map(toPlaceSuggestion);
}

// ============================================================================
// Airline credits — create, get, list
// ============================================================================

export async function createAirlineCredit(
  payload: DuffelAirlineCreditCreateWire
): Promise<DuffelAirlineCreditWire> {
  const token = env.duffelApiToken();
  if (!token) throw new Error('DUFFEL_API_TOKEN not set.');
  const res = await fetch('https://api.duffel.com/air/airline_credits', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Duffel-Version': 'v2',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ data: payload }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`duffel.airline_credits.create ${res.status}: ${body.slice(0, 400)}`);
  }
  const json = (await res.json()) as { data: DuffelAirlineCreditWire };
  return json.data;
}

export async function getAirlineCredit(
  id: DuffelAirlineCreditId | string
): Promise<DuffelAirlineCreditWire> {
  const token = env.duffelApiToken();
  if (!token) throw new Error('DUFFEL_API_TOKEN not set.');
  const res = await fetch(`https://api.duffel.com/air/airline_credits/${encodeURIComponent(id)}`, {
    headers: {
      Accept: 'application/json',
      'Duffel-Version': 'v2',
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`duffel.airline_credits.get ${res.status}: ${body.slice(0, 400)}`);
  }
  const json = (await res.json()) as { data: DuffelAirlineCreditWire };
  return json.data;
}

export interface ListAirlineCreditsParams {
  userId?: DuffelCustomerUserId;
  limit?: number;
  after?: string;
  before?: string;
}

export async function listAirlineCredits(
  params: ListAirlineCreditsParams = {}
): Promise<{ data: DuffelAirlineCreditWire[]; meta?: { after?: string; before?: string } }> {
  const token = env.duffelApiToken();
  if (!token) throw new Error('DUFFEL_API_TOKEN not set.');
  const qs = new URLSearchParams();
  if (params.userId) qs.set('user_id', params.userId);
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.after) qs.set('after', params.after);
  if (params.before) qs.set('before', params.before);
  const res = await fetch(`https://api.duffel.com/air/airline_credits?${qs.toString()}`, {
    headers: {
      Accept: 'application/json',
      'Duffel-Version': 'v2',
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`duffel.airline_credits.list ${res.status}: ${body.slice(0, 400)}`);
  }
  return (await res.json()) as {
    data: DuffelAirlineCreditWire[];
    meta?: { after?: string; before?: string };
  };
}

// ============================================================================
// Order cancellations — quote + confirm
// ============================================================================

export async function createOrderCancellation(
  orderId: DuffelOrderId | string
): Promise<DuffelOrderCancellationWire> {
  const token = env.duffelApiToken();
  if (!token) throw new Error('DUFFEL_API_TOKEN not set.');
  const res = await fetch('https://api.duffel.com/air/order_cancellations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Duffel-Version': 'v2',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ data: { order_id: orderId } }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`duffel.order_cancellations.create ${res.status}: ${body.slice(0, 400)}`);
  }
  const json = (await res.json()) as { data: DuffelOrderCancellationWire };
  return json.data;
}

export async function confirmOrderCancellation(
  cancellationId: DuffelOrderCancellationId | string
): Promise<DuffelOrderCancellationWire> {
  const token = env.duffelApiToken();
  if (!token) throw new Error('DUFFEL_API_TOKEN not set.');
  const res = await fetch(
    `https://api.duffel.com/air/order_cancellations/${encodeURIComponent(cancellationId)}/actions/confirm`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Duffel-Version': 'v2',
        Authorization: `Bearer ${token}`,
      },
    }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`duffel.order_cancellations.confirm ${res.status}: ${body.slice(0, 400)}`);
  }
  const json = (await res.json()) as { data: DuffelOrderCancellationWire };
  return json.data;
}

// ============================================================================
// Order changes — request, select offer, create + confirm
// ============================================================================

export async function createOrderChangeRequest(args: {
  orderId: DuffelOrderId | string;
  slices: {
    add: DuffelOrderChangeSliceAdd[];
    remove: DuffelOrderChangeSliceRemove[];
  };
}): Promise<DuffelOrderChangeRequestWire> {
  const token = env.duffelApiToken();
  if (!token) throw new Error('DUFFEL_API_TOKEN not set.');
  const res = await fetch('https://api.duffel.com/air/order_change_requests', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Duffel-Version': 'v2',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ data: { order_id: args.orderId, slices: args.slices } }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`duffel.order_change_requests.create ${res.status}: ${body.slice(0, 400)}`);
  }
  const json = (await res.json()) as { data: DuffelOrderChangeRequestWire };
  return json.data;
}

export async function getOrderChangeRequest(
  id: DuffelOrderChangeRequestId | string
): Promise<DuffelOrderChangeRequestWire> {
  const token = env.duffelApiToken();
  if (!token) throw new Error('DUFFEL_API_TOKEN not set.');
  const res = await fetch(
    `https://api.duffel.com/air/order_change_requests/${encodeURIComponent(id)}`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Duffel-Version': 'v2',
        Authorization: `Bearer ${token}`,
      },
    }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`duffel.order_change_requests.get ${res.status}: ${body.slice(0, 400)}`);
  }
  const json = (await res.json()) as { data: DuffelOrderChangeRequestWire };
  return json.data;
}

export async function getOrderChangeOffer(
  id: DuffelOrderChangeOfferId | string
): Promise<DuffelOrderChangeOfferWire> {
  const token = env.duffelApiToken();
  if (!token) throw new Error('DUFFEL_API_TOKEN not set.');
  const res = await fetch(
    `https://api.duffel.com/air/order_change_offers/${encodeURIComponent(id)}`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Duffel-Version': 'v2',
        Authorization: `Bearer ${token}`,
      },
    }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`duffel.order_change_offers.get ${res.status}: ${body.slice(0, 400)}`);
  }
  const json = (await res.json()) as { data: DuffelOrderChangeOfferWire };
  return json.data;
}

export async function createOrderChange(
  offerId: DuffelOrderChangeOfferId | string
): Promise<DuffelOrderChangeWire> {
  const token = env.duffelApiToken();
  if (!token) throw new Error('DUFFEL_API_TOKEN not set.');
  const res = await fetch('https://api.duffel.com/air/order_changes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Duffel-Version': 'v2',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ data: { selected_order_change_offer: offerId } }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`duffel.order_changes.create ${res.status}: ${body.slice(0, 400)}`);
  }
  const json = (await res.json()) as { data: DuffelOrderChangeWire };
  return json.data;
}

export async function confirmOrderChange(args: {
  changeId: DuffelOrderChangeId | string;
  payment: { type: 'balance' | 'arc' | 'card'; amount: string; currency: string };
}): Promise<DuffelOrderChangeWire> {
  const token = env.duffelApiToken();
  if (!token) throw new Error('DUFFEL_API_TOKEN not set.');
  const res = await fetch(
    `https://api.duffel.com/air/order_changes/${encodeURIComponent(args.changeId)}/actions/confirm`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Duffel-Version': 'v2',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ data: { payment: args.payment } }),
    }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`duffel.order_changes.confirm ${res.status}: ${body.slice(0, 400)}`);
  }
  const json = (await res.json()) as { data: DuffelOrderChangeWire };
  return json.data;
}

// ============================================================================
// Stays — quotes + bookings
// ============================================================================

export async function createStayQuote(
  rateId: DuffelStaysRateId | string
): Promise<DuffelStaysQuoteWire> {
  const duffel = getDuffel();
  const stays = duffel.stays as unknown as {
    quotes: { create: (id: string) => Promise<{ data: DuffelStaysQuoteWire }> };
  };
  const r = await stays.quotes.create(String(rateId));
  return r.data;
}

export async function createStayBooking(
  payload: DuffelStaysBookingPayloadWire
): Promise<DuffelStaysBookingWire> {
  const duffel = getDuffel();
  const stays = duffel.stays as unknown as {
    bookings: {
      create: (body: DuffelStaysBookingPayloadWire) => Promise<{ data: DuffelStaysBookingWire }>;
    };
  };
  const r = await stays.bookings.create(payload);
  return r.data;
}

export async function getStayQuote(id: DuffelStaysQuoteId | string): Promise<DuffelStaysQuoteWire> {
  const duffel = getDuffel();
  const stays = duffel.stays as unknown as {
    quotes: { get: (id: string) => Promise<{ data: DuffelStaysQuoteWire }> };
  };
  const r = await stays.quotes.get(String(id));
  return r.data;
}

// ============================================================================
// Air payments — mixed balance/card/airline-credit splits on hold orders
// ============================================================================

export type DuffelPaymentType = 'balance' | 'card' | 'airline_credit' | 'arc_bsp_cash';

export interface DuffelPaymentInput {
  type: DuffelPaymentType;
  amount: string;
  currency: DuffelCurrencyCode;
  /** Required when type === 'airline_credit'. */
  airline_credit_id?: DuffelAirlineCreditId;
  /** Required when type === 'card'. */
  card_id?: string;
  three_d_secure_session_id?: string;
}

export interface DuffelPaymentWire {
  id: string;
  type: DuffelPaymentType | (string & {});
  amount: string;
  currency: DuffelCurrencyCode;
  order_id: DuffelOrderId;
  status: 'succeeded' | 'failed' | 'pending' | 'cancelled' | (string & {});
  created_at: string;
  card_id?: string;
  airline_credit_id?: DuffelAirlineCreditId;
  failure_reason?: string;
}

export async function payOrder(args: {
  orderId: DuffelOrderId | string;
  payments: DuffelPaymentInput[];
}): Promise<DuffelPaymentWire[]> {
  const token = env.duffelApiToken();
  if (!token) throw new Error('DUFFEL_API_TOKEN not set.');
  const res = await fetch('https://api.duffel.com/air/payments', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Duffel-Version': 'v2',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      data: { order_id: args.orderId, payments: args.payments },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`duffel.payments.create ${res.status}: ${body.slice(0, 400)}`);
  }
  const json = (await res.json()) as { data: DuffelPaymentWire[] };
  return json.data;
}

// ============================================================================
// Stays — negotiated rates CRUD
// ============================================================================

export interface DuffelStaysNegotiatedRatePayload {
  displayName: string;
  rateAccessCode: string;
  accommodationIds: string[];
}

export async function createStaysNegotiatedRate(p: DuffelStaysNegotiatedRatePayload): Promise<{
  id: string;
  display_name: string;
  rate_access_code: string;
  accommodation_ids: string[];
  live_mode: boolean;
}> {
  const token = env.duffelApiToken();
  if (!token) throw new Error('DUFFEL_API_TOKEN not set.');
  const res = await fetch('https://api.duffel.com/stays/negotiated_rates', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Duffel-Version': 'v2',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      data: {
        display_name: p.displayName,
        rate_access_code: p.rateAccessCode,
        accommodation_ids: p.accommodationIds,
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`duffel.stays.negotiated_rates.create ${res.status}: ${body.slice(0, 400)}`);
  }
  const json = (await res.json()) as {
    data: Awaited<ReturnType<typeof createStaysNegotiatedRate>>;
  };
  return json.data;
}

export async function updateStaysNegotiatedRate(
  id: string,
  patch: Partial<DuffelStaysNegotiatedRatePayload>
): Promise<Awaited<ReturnType<typeof createStaysNegotiatedRate>>> {
  const token = env.duffelApiToken();
  if (!token) throw new Error('DUFFEL_API_TOKEN not set.');
  const body: Record<string, unknown> = {};
  if (patch.displayName) body.display_name = patch.displayName;
  if (patch.rateAccessCode) body.rate_access_code = patch.rateAccessCode;
  if (patch.accommodationIds) body.accommodation_ids = patch.accommodationIds;
  const res = await fetch(
    `https://api.duffel.com/stays/negotiated_rates/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Duffel-Version': 'v2',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ data: body }),
    }
  );
  if (!res.ok) {
    const b = await res.text();
    throw new Error(`duffel.stays.negotiated_rates.update ${res.status}: ${b.slice(0, 400)}`);
  }
  const json = (await res.json()) as {
    data: Awaited<ReturnType<typeof createStaysNegotiatedRate>>;
  };
  return json.data;
}

export async function deleteStaysNegotiatedRate(id: string): Promise<void> {
  const token = env.duffelApiToken();
  if (!token) throw new Error('DUFFEL_API_TOKEN not set.');
  const res = await fetch(
    `https://api.duffel.com/stays/negotiated_rates/${encodeURIComponent(id)}`,
    {
      method: 'DELETE',
      headers: {
        Accept: 'application/json',
        'Duffel-Version': 'v2',
        Authorization: `Bearer ${token}`,
      },
    }
  );
  if (!res.ok && res.status !== 204) {
    const body = await res.text();
    throw new Error(`duffel.stays.negotiated_rates.delete ${res.status}: ${body.slice(0, 400)}`);
  }
}
