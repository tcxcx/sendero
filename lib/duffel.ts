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
import { env } from './env';

let client: Duffel | null = null;

export function getDuffel(): Duffel {
  if (!client) {
    const token = env.duffelApiToken();
    if (!token) {
      throw new Error(
        'DUFFEL_API_TOKEN not set. Add it to .env.local or flip PASILLO_DEMO_FALLBACK=true.',
      );
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

export async function searchFlights(
  params: FlightSearchParams,
): Promise<FlightOfferSummary[]> {
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
    const lastSegment =
      o.slices?.[0]?.segments?.[o.slices[0].segments.length - 1];
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
  passengerDob?: string;
  passengerGender?: 'male' | 'female';
  idempotencyKey: string;
}

export interface HoldOrderResult {
  orderId: string;
  bookingReference: string;
  totalAmount: string;
  totalCurrency: string;
  paymentRequiredBy: string;
}

export async function createHoldOrder(
  params: HoldOrderParams,
): Promise<HoldOrderResult> {
  const duffel = getDuffel();

  // Duffel requires a passenger ID that matches the offer's passenger ID.
  const offer = await duffel.offers.get(params.offerId);
  const passengerId =
    (offer.data as any).passengers?.[0]?.id || 'pax_0001';

  const [givenName, ...rest] = params.passengerName.split(' ');
  const familyName = rest.join(' ') || 'Traveler';

  const response = await duffel.orders.create({
    selected_offers: [params.offerId],
    type: 'hold',
    passengers: [
      {
        id: passengerId,
        given_name: givenName || 'Guest',
        family_name: familyName,
        email: params.passengerEmail,
        born_on: params.passengerDob || '1990-01-01',
        gender: params.passengerGender === 'female' ? 'f' : 'm',
        title: 'mr',
        type: 'adult' as const,
      },
    ],
    metadata: { idempotency_key: params.idempotencyKey },
  } as any);

  return {
    orderId: response.data.id,
    bookingReference: response.data.booking_reference,
    totalAmount: response.data.total_amount,
    totalCurrency: response.data.total_currency,
    paymentRequiredBy:
      (response.data as any).payment_status?.payment_required_by || '',
  };
}

export interface PayFromBalanceResult {
  paymentId: string;
  status: string;
  amount: string;
  currency: string;
}

export async function payFromBalance(
  orderId: string,
): Promise<PayFromBalanceResult> {
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

/**
 * Curated hotels for demo use when Duffel Stays isn't enabled on the token.
 * Photos come from Unsplash's open CDN (licensed for demo use).
 */
function curatedHotelsFor(params: HotelSearchParams): HotelOfferSummary[] {
  const nights = Math.max(
    1,
    Math.round(
      (new Date(params.checkOutDate).getTime() -
        new Date(params.checkInDate).getTime()) /
        (1000 * 60 * 60 * 24),
    ),
  );
  const loc = params.location;
  const UNSPLASH = (id: string) =>
    `https://images.unsplash.com/${id}?auto=format&fit=crop&w=640&q=80`;

  const base = [
    {
      name: 'The Hoxton',
      stars: 4,
      review: 8.6,
      nightly: 214,
      currency: 'GBP',
      cancel: 'free' as const,
      photo: 'photo-1566073771259-6a8506099945',
      amenities: ['wifi', 'breakfast', 'gym', 'bar'],
    },
    {
      name: 'citizenM',
      stars: 4,
      review: 8.9,
      nightly: 189,
      currency: 'GBP',
      cancel: 'partial' as const,
      photo: 'photo-1578683010236-d716f9a3f461',
      amenities: ['wifi', 'self_checkin', '24h_food'],
    },
    {
      name: 'The Standard',
      stars: 5,
      review: 9.1,
      nightly: 342,
      currency: 'GBP',
      cancel: 'free' as const,
      photo: 'photo-1582719508461-905c673771fd',
      amenities: ['wifi', 'pool', 'spa', 'restaurant'],
    },
    {
      name: 'Hotel Edition',
      stars: 5,
      review: 9.3,
      nightly: 465,
      currency: 'GBP',
      cancel: 'non_refundable' as const,
      photo: 'photo-1564501049412-61c2a3083791',
      amenities: ['wifi', 'pool', 'spa', 'fine_dining'],
    },
    {
      name: 'Ace Hotel',
      stars: 4,
      review: 8.4,
      nightly: 178,
      currency: 'GBP',
      cancel: 'partial' as const,
      photo: 'photo-1520250497591-112f2f40a3f4',
      amenities: ['wifi', 'coffee', 'coworking'],
    },
    {
      name: 'Generator',
      stars: 3,
      review: 8.0,
      nightly: 98,
      currency: 'GBP',
      cancel: 'free' as const,
      photo: 'photo-1455587734955-081b22074882',
      amenities: ['wifi', 'bar', 'common_room'],
    },
  ];

  return base.map((h, i): HotelOfferSummary => ({
    id: `curated_${i}`,
    name: `${h.name}, ${loc}`,
    city: loc,
    country: null,
    stars: h.stars,
    reviewScore: h.review,
    photos: [UNSPLASH(h.photo)],
    price: (h.nightly * nights).toFixed(2),
    currency: h.currency,
    cancellation: h.cancel,
    distanceMeters: 500 + i * 300,
    amenities: h.amenities,
  }));
}

function resolveCoords(
  loc: string,
): { lat: number; lng: number; name: string } {
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
export async function searchHotels(
  params: HotelSearchParams,
): Promise<HotelOfferSummary[]> {
  const duffel = getDuffel();
  const coords = resolveCoords(params.location);
  const radiusKm = params.radiusKm ?? 5;

  let response: any;
  try {
    response = await (duffel.stays as any).search({
      location: {
        radius: radiusKm,
        geographic_coordinates: { latitude: coords.lat, longitude: coords.lng },
      },
      check_in_date: params.checkInDate,
      check_out_date: params.checkOutDate,
      rooms: params.rooms ?? 1,
      guests: Array.from(
        { length: params.guests ?? 1 },
        () => ({ type: 'adult' } as any),
      ),
    } as any);
  } catch (err) {
    // Duffel Stays is an opt-in product — sandbox tokens typically don't
    // have it enabled. Fall back to a curated deck with real hotel photos
    // so the demo still works end-to-end.
    console.warn(
      '[stays] Duffel Stays not available on this token; using curated fallback.',
    );
    return curatedHotelsFor(params);
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
    const cancellation: HotelOfferSummary['cancellation'] =
      (r.rates ?? []).some(
        (rate: any) =>
          rate.cancellation_timeline?.some(
            (c: any) => parseFloat(c.refund_amount) >= parseFloat(rate.total_amount),
          ),
      )
        ? 'free'
        : (r.rates ?? []).some(
              (rate: any) => parseFloat(rate.total_amount) > 0,
            )
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
