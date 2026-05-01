import { exportRouteMap } from './export-route-map';
import { recommendRestaurants } from './recommend-restaurants';
import { restaurantRouteCard } from './restaurant-route-card';
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const ORIGINAL_GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const ORIGINAL_GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;

function restoreEnv() {
  if (ORIGINAL_GOOGLE_API_KEY === undefined) delete process.env.GOOGLE_API_KEY;
  else process.env.GOOGLE_API_KEY = ORIGINAL_GOOGLE_API_KEY;
  if (ORIGINAL_GOOGLE_MAPS_API_KEY === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
  else process.env.GOOGLE_MAPS_API_KEY = ORIGINAL_GOOGLE_MAPS_API_KEY;
  if (ORIGINAL_GOOGLE_PLACES_API_KEY === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
  else process.env.GOOGLE_PLACES_API_KEY = ORIGINAL_GOOGLE_PLACES_API_KEY;
}

function installPlacesMock() {
  const calls: Array<{ url: string; body: Record<string, unknown>; headers: Headers }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers = new Headers(init?.headers);
    calls.push({
      url,
      body: init?.body ? JSON.parse(String(init.body)) : {},
      headers,
    });
    return Response.json({
      places: [
        {
          id: 'place_top',
          displayName: { text: 'Casa Sendero' },
          formattedAddress: 'Av Siempre Viva 123, Buenos Aires',
          shortFormattedAddress: 'Palermo, Buenos Aires',
          location: { latitude: -34.58, longitude: -58.42 },
          businessStatus: 'OPERATIONAL',
          types: ['restaurant', 'food', 'point_of_interest'],
          primaryType: 'argentinian_restaurant',
          priceLevel: 'PRICE_LEVEL_MODERATE',
          rating: 4.8,
          userRatingCount: 1200,
          regularOpeningHours: { openNow: true },
          websiteUri: 'https://example.test/casa',
          internationalPhoneNumber: '+54 11 5555 0000',
        },
        {
          id: 'place_filtered',
          displayName: { text: 'Not Dinner' },
          formattedAddress: 'Avenida 1',
          businessStatus: 'OPERATIONAL',
          types: ['store'],
          primaryType: 'store',
          rating: 5,
          userRatingCount: 1,
        },
        {
          id: 'place_second',
          displayName: { text: 'Mesa Local' },
          formattedAddress: 'Calle 2, Buenos Aires',
          shortFormattedAddress: 'Recoleta',
          location: { latitude: -34.59, longitude: -58.39 },
          businessStatus: 'OPERATIONAL',
          types: ['restaurant'],
          primaryType: 'restaurant',
          priceLevel: 'PRICE_LEVEL_EXPENSIVE',
          rating: 4.5,
          userRatingCount: 800,
          regularOpeningHours: { openNow: false },
        },
      ],
    });
  }) as typeof fetch;
  return calls;
}

beforeEach(() => {
  process.env.GOOGLE_API_KEY = 'test-google-key';
  delete process.env.GOOGLE_MAPS_API_KEY;
  delete process.env.GOOGLE_PLACES_API_KEY;
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  restoreEnv();
});

describe('trip lifecycle route and recommendation tools', () => {
  test('export_route_map returns channel-ready directions without a Maps key when static map is disabled', async () => {
    delete process.env.GOOGLE_API_KEY;
    delete process.env.GOOGLE_MAPS_API_KEY;

    const route = await exportRouteMap({
      title: 'Hotel to dinner',
      includeStaticMap: false,
      mode: 'walking',
      stops: [
        { label: 'Hotel', address: 'Park Hyatt Buenos Aires' },
        { label: 'Dinner', address: 'Don Julio Buenos Aires' },
      ],
    });

    expect(route.staticMapUrl).toBeUndefined();
    expect(route.googleMapsUrl).toContain('https://www.google.com/maps/dir/');
    expect(route.appleMapsUrl).toContain('dirflg=w');
    expect(route.share.whatsappUrl).toStartWith('https://wa.me/?text=');
    expect(route.share.slackMrkdwn).toContain('Open in Google Maps');
    expect(route.stops.map(stop => stop.role)).toEqual(['origin', 'destination']);
  });

  test('recommend_restaurants filters non-restaurants and sends Google Places text-search shape', async () => {
    const calls = installPlacesMock();

    const result = await recommendRestaurants({
      location: 'Palermo Buenos Aires',
      cuisine: 'parrilla',
      priceLevel: 'moderate',
      limit: 3,
      languageCode: 'es',
    });

    expect(result.query).toBe('parrilla restaurant in Palermo Buenos Aires');
    expect(result.total).toBe(2);
    expect(result.restaurants.map(place => place.name)).toEqual(['Casa Sendero', 'Mesa Local']);
    expect(calls[0]?.url).toBe('https://places.googleapis.com/v1/places:searchText');
    expect(calls[0]?.headers.get('X-Goog-Api-Key')).toBe('test-google-key');
    expect(calls[0]?.body).toMatchObject({
      textQuery: 'parrilla restaurant in Palermo Buenos Aires',
      languageCode: 'es',
      includedType: 'restaurant',
    });
    expect(calls[0]?.body.priceLevels).toEqual(['PRICE_LEVEL_MODERATE']);
  });

  test('restaurant_route_card ranks a top pick and emits WhatsApp/Slack route artifacts', async () => {
    installPlacesMock();

    const card = await restaurantRouteCard({
      location: 'Buenos Aires',
      cuisine: 'parrilla',
      fromLabel: 'Hotel',
      fromAddress: 'Park Hyatt Buenos Aires',
      occasion: 'client dinner',
      mode: 'walking',
      limit: 2,
      languageCode: 'en',
    });

    expect(card.topPick?.name).toBe('Casa Sendero');
    expect(card.routeLinks?.googleMapsUrl).toContain('destination=-34.58%2C-58.42');
    expect(card.routeLinks?.googleMapsUrl).toContain('destination_place_id=place_top');
    expect(card.previewCard.primaryLink.label).toContain('Route');
    expect(card.share.bullets[0]).toContain('client dinner');
    expect(card.share.whatsappUrl).toStartWith('https://wa.me/?text=');
    expect(card.share.slackMrkdwn).toContain('Route in Google Maps');
    expect(card.staticMapUrl).toContain('maps.googleapis.com/maps/api/staticmap');
  });
});

describe('trip disruption lifecycle tool', () => {
  test('trip_delay_replanner composes rebook, hotel, route, and channel share payloads', async () => {
    mock.module('@sendero/duffel', () => ({
      searchFlights: async () => [
        {
          id: 'off_1',
          total_amount: '420.00',
          total_currency: 'USD',
          owner: { name: 'Sendero Air' },
          slices: [
            {
              origin: { iataCode: 'JFK' },
              destination: { iataCode: 'LHR' },
              segments: [
                {
                  origin: { iataCode: 'JFK' },
                  destination: { iataCode: 'LHR' },
                  departing_at: '2026-06-01T22:00:00',
                  arriving_at: '2026-06-02T10:00:00',
                },
              ],
            },
          ],
        },
        {
          id: 'off_2',
          total_amount: '500.00',
          total_currency: 'USD',
          slices: [{ origin: { iataCode: 'JFK' }, destination: { iataCode: 'LHR' }, segments: [] }],
        },
      ],
      searchHotels: async () => [
        {
          id: 'hotel_1',
          name: 'Airport Rest Hotel',
          total_amount: '180.00',
          total_currency: 'USD',
          address: { city_name: 'Jamaica' },
          photos: [{ url: 'https://example.test/hotel.jpg' }],
        },
      ],
    }));
    const { tripDelayReplanner } = await import('./trip-delay-replanner');

    const result = await tripDelayReplanner({
      originalLeg: {
        pnr: 'ABC123',
        flightNumber: 'AA100',
        origin: 'JFK',
        destination: 'LHR',
        scheduledDepartureIso: '2026-06-01T18:00:00',
      },
      disruption: { kind: 'missed_connection', reason: 'Inbound aircraft delay' },
      rebookSearch: { departureDate: '2026-06-01', passengers: 1, cabinClass: 'economy' },
      needsHotelFallback: true,
      stayLocation: 'JFK',
      stayCheckInDate: '2026-06-01',
      stayCheckOutDate: '2026-06-02',
      travelerLabel: 'Casey',
      notifyChannels: ['whatsapp', 'slack'],
      transferMode: 'driving',
    });

    expect(result.recommendedRebook?.offerId).toBe('off_1');
    expect(result.hotelFallback?.name).toBe('Airport Rest Hotel');
    expect(result.routeLinks?.googleMapsUrl).toContain('Airport+Rest+Hotel');
    expect(result.notify.channels).toEqual(['whatsapp', 'slack']);
    expect(result.share.primaryCta).toMatchObject({ kind: 'rebook', offerId: 'off_1' });
    expect(result.share.secondaryCtas.some(cta => cta.label.includes('Airport'))).toBe(true);
    expect(result.share.whatsappUrl).toStartWith('https://wa.me/?text=');
    expect(result.share.slackMrkdwn).toContain('Missed connection');
  });
});
