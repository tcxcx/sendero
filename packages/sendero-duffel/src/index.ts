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
import { env } from '@sendero/env';

import type {
  DuffelAvailableServiceBaggageWire,
  DuffelAvailableServiceCFARWire,
  DuffelAvailableServiceWire,
  DuffelCreateOrderWire,
  DuffelCustomerUserGroupPayloadWire,
  DuffelCustomerUserGroupWire,
  DuffelCustomerUserId,
  DuffelCustomerUserPayloadWire,
  DuffelCustomerUserWire,
  DuffelOfferWireMinimal,
  DuffelSeatMapWire,
  DuffelServiceId,
} from './types';

export {
  verifyDuffelSignature,
  parseDuffelWebhook,
  type DuffelWebhookEvent,
  type DuffelWebhookStatus,
  type DuffelWebhookEventType,
} from './webhook';
export * from './types';

let client: Duffel | null = null;

export function getDuffel(): Duffel {
  if (!client) {
    const token = env.duffelApiToken();
    if (!token) {
      throw new Error('DUFFEL_API_TOKEN not set. Add it to .env.local.');
    }
    client = new Duffel({ token } as any);
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
}

export async function searchFlights(params: FlightSearchParams): Promise<FlightOfferSummary[]> {
  const duffel = getDuffel();

  const passengerCount = params.passengers ?? 1;
  const passengers = Array.from({ length: passengerCount }, () => ({
    type: 'adult' as const,
  }));

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

  const response = await duffel.offerRequests.create({
    slices,
    passengers,
    cabin_class: params.cabinClass ?? 'economy',
    return_offers: true,
  } as any);

  const offers = ((response.data as any).offers || []).slice(0, 10);

  return offers.map((o: any): FlightOfferSummary => {
    const firstSegment = o.slices?.[0]?.segments?.[0];
    const lastSegment = o.slices?.[0]?.segments?.[o.slices[0].segments.length - 1];
    const owner = o.owner ?? {};
    const iata = owner.iata_code || '';
    return {
      id: o.id,
      airline: owner.name || 'Unknown',
      airlineIataCode: iata,
      // Prefer Duffel-supplied URLs; fall back to the CDN pattern that exists
      // for every IATA carrier.
      airlineLogoUrl:
        owner.logo_symbol_url ||
        (iata
          ? `https://assets.duffel.com/img/airlines/for-light-background/full-color-logo/${iata}.svg`
          : null),
      airlineLockupUrl:
        owner.logo_lockup_url ||
        (iata
          ? `https://assets.duffel.com/img/airlines/for-light-background/full-color-lockup/${iata}.svg`
          : null),
      airlineConditionsOfCarriageUrl: owner.conditions_of_carriage_url || null,
      price: o.total_amount,
      currency: o.total_currency,
      departure: firstSegment?.departing_at || '',
      arrival: lastSegment?.arriving_at || '',
      originCode: firstSegment?.origin?.iata_code || params.origin,
      originCity: firstSegment?.origin?.city_name || null,
      destinationCode: lastSegment?.destination?.iata_code || params.destination,
      destinationCity: lastSegment?.destination?.city_name || null,
      duration: o.slices?.[0]?.duration || '',
      stops: Math.max(0, (o.slices?.[0]?.segments?.length || 1) - 1),
      cabinClass: firstSegment?.passengers?.[0]?.cabin_class || 'economy',
      expiresAt: o.expires_at,
    };
  });
}

export interface HoldOrderParams {
  offerId: string;
  passengerName: string;
  passengerEmail: string;
  passengerPhone?: string;
  passengerDob?: string;
  passengerGender?: 'male' | 'female';
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

export interface HoldOrderResult {
  orderId: string;
  bookingReference: string;
  totalAmount: string;
  totalCurrency: string;
  paymentRequiredBy: string;
  /** Snapshot of the services that were attached at creation time. */
  services: Array<{ id: string; quantity: number }>;
}

export async function createHoldOrder(params: HoldOrderParams): Promise<HoldOrderResult> {
  const duffel = getDuffel();

  // Duffel requires a passenger ID that matches the offer's passenger ID.
  const offerResp = await duffel.offers.get(params.offerId);
  const offer = offerResp.data as unknown as DuffelOfferWireMinimal;
  const passengerId = offer.passengers?.[0]?.id || 'pax_0001';

  const [givenName, ...rest] = params.passengerName.split(' ');
  const familyName = rest.join(' ') || 'Traveler';

  const primaryCustomerUserId = params.customerUserIds?.[0] as DuffelCustomerUserId | undefined;

  const order: DuffelCreateOrderWire = {
    selected_offers: [params.offerId as DuffelCreateOrderWire['selected_offers'][number]],
    type: 'hold',
    passengers: [
      {
        id: passengerId,
        given_name: givenName || 'Guest',
        family_name: familyName,
        email: params.passengerEmail,
        phone_number: params.passengerPhone || '+447123456789',
        born_on: params.passengerDob || '1990-01-01',
        gender: params.passengerGender === 'female' ? 'f' : 'm',
        title: 'mr',
        type: 'adult',
        ...(primaryCustomerUserId ? { user_id: primaryCustomerUserId } : {}),
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

  const response = await duffel.orders.create(
    order as unknown as Parameters<typeof duffel.orders.create>[0]
  );
  const orderData = response.data as unknown as {
    id: string;
    booking_reference: string;
    total_amount: string;
    total_currency: string;
    payment_status?: { payment_required_by?: string };
  };

  return {
    orderId: orderData.id,
    bookingReference: orderData.booking_reference,
    totalAmount: orderData.total_amount,
    totalCurrency: orderData.total_currency,
    paymentRequiredBy: orderData.payment_status?.payment_required_by || '',
    services: params.services ?? [],
  };
}

export interface PayFromBalanceResult {
  paymentId: string;
  status: string;
  amount: string;
  currency: string;
}

export async function payFromBalance(orderId: string): Promise<PayFromBalanceResult> {
  const duffel = getDuffel();

  // Fetch latest price before paying (Duffel best practice)
  const latest = await duffel.orders.get(orderId);
  const totalAmount = latest.data.total_amount;
  const totalCurrency = latest.data.total_currency;

  const response = await duffel.payments.create({
    order_id: orderId,
    payment: {
      type: 'balance',
      amount: totalAmount,
      currency: totalCurrency,
    },
  } as any);

  return {
    paymentId: (response.data as any).id,
    status: (response.data as any).status || 'succeeded',
    amount: totalAmount,
    currency: totalCurrency,
  };
}

export async function getOrder(orderId: string) {
  const duffel = getDuffel();
  const r = await duffel.orders.get(orderId);
  return r.data;
}

// ============================================================================
// Stays (hotels)
// ============================================================================

export interface HotelSearchParams {
  /** City or neighborhood name — we geocode internally. Also accepts lat,lng. */
  location: string;
  checkInDate: string;
  checkOutDate: string;
  guests?: number;
  rooms?: number;
  /** Search radius in km (default 5). */
  radiusKm?: number;
}

/**
 * Minimal hackathon-grade city-to-coords map. Case-insensitive prefix match.
 * Also accepts raw "lat,lng" strings.
 */
const CITY_COORDS: Record<string, { lat: number; lng: number }> = {
  london: { lat: 51.5074, lng: -0.1278 },
  paris: { lat: 48.8566, lng: 2.3522 },
  'new york': { lat: 40.7128, lng: -74.006 },
  nyc: { lat: 40.7128, lng: -74.006 },
  'san francisco': { lat: 37.7749, lng: -122.4194 },
  sfo: { lat: 37.7749, lng: -122.4194 },
  boston: { lat: 42.3601, lng: -71.0589 },
  chicago: { lat: 41.8781, lng: -87.6298 },
  berlin: { lat: 52.52, lng: 13.405 },
  barcelona: { lat: 41.3851, lng: 2.1734 },
  madrid: { lat: 40.4168, lng: -3.7038 },
  lisbon: { lat: 38.7223, lng: -9.1393 },
  rome: { lat: 41.9028, lng: 12.4964 },
  amsterdam: { lat: 52.3676, lng: 4.9041 },
  dublin: { lat: 53.3498, lng: -6.2603 },
  dubai: { lat: 25.2048, lng: 55.2708 },
  singapore: { lat: 1.3521, lng: 103.8198 },
  tokyo: { lat: 35.6762, lng: 139.6503 },
  'buenos aires': { lat: -34.6037, lng: -58.3816 },
  'são paulo': { lat: -23.5505, lng: -46.6333 },
  'sao paulo': { lat: -23.5505, lng: -46.6333 },
  'mexico city': { lat: 19.4326, lng: -99.1332 },
  'los angeles': { lat: 34.0522, lng: -118.2437 },
  miami: { lat: 25.7617, lng: -80.1918 },
  austin: { lat: 30.2672, lng: -97.7431 },
  seattle: { lat: 47.6062, lng: -122.3321 },
};

function resolveCoords(loc: string): { lat: number; lng: number; name: string } {
  const trimmed = loc.trim().toLowerCase();

  // Raw "lat,lng"
  const numMatch = trimmed.match(/^(-?\d+(\.\d+)?),\s*(-?\d+(\.\d+)?)$/);
  if (numMatch) {
    return { lat: Number(numMatch[1]), lng: Number(numMatch[3]), name: loc };
  }

  // Exact or prefix match on city name
  if (CITY_COORDS[trimmed]) {
    return { ...CITY_COORDS[trimmed], name: loc };
  }
  for (const key of Object.keys(CITY_COORDS)) {
    if (trimmed.startsWith(key) || key.startsWith(trimmed)) {
      return { ...CITY_COORDS[key], name: loc };
    }
  }

  // Fallback: London (so demo always returns something)
  return { ...CITY_COORDS.london, name: `${loc} (fallback: London)` };
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
 * Search hotels via Duffel Stays API.
 * Returns the top 6 accommodations ranked by Duffel's default ordering,
 * each with real photos + the cheapest available rate.
 */
export async function searchHotels(params: HotelSearchParams): Promise<HotelOfferSummary[]> {
  const duffel = getDuffel();
  const coords = resolveCoords(params.location);
  const radiusKm = params.radiusKm ?? 5;

  let response: any;
  try {
    response = await (duffel.stays as any).search({
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
      guests: Array.from({ length: params.guests ?? 1 }, () => ({ type: 'adult' }) as any),
    } as any);
  } catch (err) {
    // Duffel Stays is an opt-in product — most sandbox tokens don't have
    // it enabled. Surface a useful, actionable error instead of "unknown".
    const anyErr = err as any;
    console.error('[stays] raw error:', {
      name: anyErr?.name,
      code: anyErr?.code,
      statusCode: anyErr?.statusCode ?? anyErr?.meta?.status,
      meta: anyErr?.meta,
      errors: anyErr?.errors,
      message: anyErr?.message,
    });
    const firstDuffel = anyErr?.errors?.[0] ?? anyErr?.meta?.errors?.[0];
    if (firstDuffel) {
      throw new Error(
        firstDuffel.title
          ? `${firstDuffel.title}: ${firstDuffel.message || firstDuffel.detail || ''}`.trim()
          : firstDuffel.message || JSON.stringify(firstDuffel)
      );
    }
    if (anyErr?.message) {
      throw new Error(
        `Duffel Stays request failed (${anyErr.name || 'Error'}): ${anyErr.message}. Most sandbox tokens don't have Stays enabled — contact Duffel to turn it on.`
      );
    }
    throw new Error(
      'Duffel Stays request failed. This product is opt-in; the sandbox token likely does not have Stays enabled.'
    );
  }

  const results = ((response.data as any)?.results ?? []).slice(0, 6);

  return results.map((r: any): HotelOfferSummary => {
    const acc = r.accommodation ?? {};
    const cheapest = (r.cheapest_rate_total_amount as string) ?? null;
    const currency = (r.cheapest_rate_currency as string) ?? 'USD';
    const photos = (acc.photos ?? [])
      .map((p: any) => p?.url)
      .filter(Boolean)
      .slice(0, 3);
    const loc = acc.location ?? {};
    const cancellation: HotelOfferSummary['cancellation'] = (r.rates ?? []).some((rate: any) =>
      rate.cancellation_timeline?.some(
        (c: any) => parseFloat(c.refund_amount) >= parseFloat(rate.total_amount)
      )
    )
      ? 'free'
      : (r.rates ?? []).some((rate: any) => parseFloat(rate.total_amount) > 0)
        ? 'partial'
        : 'unknown';

    return {
      id: r.id,
      name: acc.name ?? 'Unknown property',
      city: loc.address?.city_name ?? null,
      country: loc.address?.country_code ?? null,
      stars: acc.rating ?? null,
      reviewScore: acc.review_score ?? null,
      photos,
      price: cheapest ?? '0',
      currency,
      cancellation,
      distanceMeters: loc.distance_meters ?? null,
      amenities: (acc.amenities ?? [])
        .map((a: any) => a?.type || a?.name)
        .filter(Boolean)
        .slice(0, 5),
    };
  });
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
