/**
 * external-data-tools — happy-path + degradation tests for the 4
 * Phase-2 x402 tools via direct dependency injection.
 *
 * Avoids `mock.module('./x402-fetch')` (process-global in bun) so
 * `x402-fetch.test.ts` can run alongside this file in CI without
 * the helper getting shadowed.
 */

import { describe, expect, mock, test } from 'bun:test';

import { runFlightDisruptionsBrief, type FlightDisruptionsBriefDeps } from './flight-disruptions-brief';
import { runNearbyAirportsLive, type NearbyAirportsLiveDeps } from './nearby-airports-live';
import { runPlacesSearch, type PlacesSearchDeps } from './places-search';
import { runPlaceDetails, type PlaceDetailsDeps } from './place-details';
import { X402Error, type X402FetchOptions } from './x402-fetch';

const ctx = {
  caller: { effectiveKeyType: 'production' as const },
  traveler: { tenantId: 'org_test', userId: 'usr_1' },
};

type FetchSig = <T>(
  url: string,
  opts: X402FetchOptions
) => Promise<{
  data: T;
  meta: {
    upstreamUrl: string;
    paidMicroUsdc: bigint;
    facilitatorResponseHeaders: Record<string, string>;
  };
}>;

function mkFetch(impl: (url: string) => Promise<unknown>): FetchSig {
  return (async (url: string) => ({
    data: (await impl(url)) as unknown,
    meta: { upstreamUrl: url, paidMicroUsdc: 0n, facilitatorResponseHeaders: {} },
  })) as FetchSig;
}

// ── flight_disruptions_brief ────────────────────────────────────────

describe('flight_disruptions_brief', () => {
  test('composes delays + weather into one share', async () => {
    let nthCall = 0;
    const fetcher: FetchSig = (async (url: string) => {
      nthCall++;
      if (url.includes('/delays')) {
        return {
          data: {
            airport_code: 'KJFK',
            delay_secs: 1800,
            category: 'weather',
            reasons: ['Low ceilings', 'Reduced visibility'],
            ground_delay: { reason: 'WX / Low Ceilings', cause: 'WX' },
          },
          meta: { upstreamUrl: url, paidMicroUsdc: 20_000n, facilitatorResponseHeaders: {} },
        };
      }
      return {
        data: {
          station_id: 'KJFK',
          observation_time: '2026-12-01T18:00:00Z',
          temp_air: 5,
          wind_direction: 270,
          wind_speed: 18,
          wind_gust: 28,
          visibility: 6.4,
          conditions: 'Light Rain, Mist',
          raw_data: 'KJFK 011800Z 27018G28KT 4SM -RA BR BKN008',
        },
        meta: { upstreamUrl: url, paidMicroUsdc: 4_000n, facilitatorResponseHeaders: {} },
      };
    }) as FetchSig;

    const out = await runFlightDisruptionsBrief({ airportCode: 'kjfk' }, ctx, {
      fetch: fetcher,
    } as FlightDisruptionsBriefDeps);
    expect(nthCall).toBe(2);
    expect(out.airportCode).toBe('KJFK');
    expect(out.delay?.averageDelayMinutes).toBe(30);
    expect(out.delay?.groundDelayReason).toBe('WX / Low Ceilings');
    expect(out.weather?.conditions).toBe('Light Rain, Mist');
    expect(out.share.title).toContain('ground delay');
    expect(out.share.body).toContain('KJFK 011800Z');
    expect(out.share.bullets.length).toBeGreaterThan(0);
    expect(out.errors).toHaveLength(0);
  });

  test('graceful degradation when one upstream fails', async () => {
    const fetcher: FetchSig = (async (url: string) => {
      if (url.includes('/delays')) {
        return {
          data: { delay_secs: 0, category: 'normal' },
          meta: { upstreamUrl: url, paidMicroUsdc: 20_000n, facilitatorResponseHeaders: {} },
        };
      }
      throw new X402Error('upstream timeout', 'upstream_error');
    }) as FetchSig;

    const out = await runFlightDisruptionsBrief({ airportCode: 'KLAX' }, ctx, {
      fetch: fetcher,
    } as FlightDisruptionsBriefDeps);
    expect(out.delay).not.toBeNull();
    expect(out.weather).toBeNull();
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0]).toContain('weather');
    expect(out.share.title).toContain('KLAX');
  });
});

// ── nearby_airports_live ────────────────────────────────────────────

describe('nearby_airports_live', () => {
  test('maps FA airports + converts NM→km', async () => {
    const fetcher = mkFetch(async () => ({
      airports: [
        {
          code_icao: 'KJFK',
          code_iata: 'JFK',
          code_lid: 'JFK',
          name: 'John F. Kennedy International Airport',
          elevation: 13,
          city: 'New York',
          distance: 6.7, // NM
          heading: 45,
          timezone: 'America/New_York',
          country_code: 'US',
        },
        {
          code_icao: 'KEWR',
          code_iata: 'EWR',
          name: 'Newark Liberty',
          distance: 12.3,
          heading: 290,
          country_code: 'US',
        },
      ],
    }));

    const out = await runNearbyAirportsLive(
      { latitude: 40.6413, longitude: -73.7781, radiusKm: 50, maxResults: 8 },
      ctx,
      { fetch: fetcher } as NearbyAirportsLiveDeps
    );
    expect(out.airports).toHaveLength(2);
    expect(out.airports[0]!.icao).toBe('KJFK');
    expect(out.airports[0]!.distanceKm).toBeGreaterThan(11); // 6.7 NM ≈ 12.4 km
    expect(out.airports[0]!.distanceKm).toBeLessThan(13);
    expect(out.share.title).toContain('2 airport(s)');
  });

  test('passes radius in NM (not km) to FA', async () => {
    const fetcherSpy = mock<FetchSig>(async (url: string) => ({
      data: { airports: [] },
      meta: { upstreamUrl: url, paidMicroUsdc: 0n, facilitatorResponseHeaders: {} },
    }));
    await runNearbyAirportsLive(
      {
        latitude: 40,
        longitude: -74,
        radiusKm: 100,
        onlyInstrumentApproach: true,
        maxResults: 8,
      },
      ctx,
      { fetch: fetcherSpy as unknown as FetchSig } as NearbyAirportsLiveDeps
    );
    const opts = fetcherSpy.mock.calls[0]![1] as { query: Record<string, unknown> };
    // 100 km × 0.539957 ≈ 54 NM
    expect(opts.query.radius).toBe(54);
    expect(opts.query.only_iap).toBe(true);
  });
});

// ── places_search ───────────────────────────────────────────────────

describe('places_search', () => {
  test('maps Tripadvisor results into share payload', async () => {
    const fetcher = mkFetch(async () => ({
      data: [
        {
          location_id: '60763',
          name: 'Empire State Building',
          address_obj: {
            address_string: '20 W 34th St, New York City, NY 10001',
            city: 'New York City',
            country: 'United States',
          },
          category: { localized_name: 'Attraction' },
          subcategory: [{ localized_name: 'Sights & Landmarks' }],
          rating: '4.5',
          num_reviews: '90432',
          latitude: '40.7484',
          longitude: '-73.9857',
          distance: '0.4', // miles from anchor
          ranking_data: { ranking_string: '#15 of 1,200 things to do in NYC' },
        },
      ],
    }));

    const out = await runPlacesSearch(
      {
        query: 'Empire State',
        latitude: 40.75,
        longitude: -73.99,
        radiusKm: 5,
        category: 'attractions',
        maxResults: 8,
      },
      ctx,
      { fetch: fetcher } as PlacesSearchDeps
    );
    expect(out.results).toHaveLength(1);
    expect(out.results[0]!.locationId).toBe('60763');
    expect(out.results[0]!.rating).toBe(4.5);
    expect(out.results[0]!.numReviews).toBe(90432);
    expect(out.results[0]!.distanceKm).toBeCloseTo(0.6, 1); // 0.4 mi ≈ 0.64 km
    expect(out.share.title).toContain('Empire State');
    expect(out.share.bullets[0]).toContain('Empire State Building');
  });
});

// ── place_details ───────────────────────────────────────────────────

describe('place_details', () => {
  test('returns share with primaryCta when web_url present', async () => {
    const fetcher = mkFetch(async () => ({
      location_id: '60763',
      name: 'Le Bernardin',
      description: 'Three-Michelin-starred seafood institution.',
      web_url: 'https://www.tripadvisor.com/Restaurant_Review-g60763',
      address_obj: { address_string: '155 W 51st St, New York' },
      category: { localized_name: 'Restaurant' },
      subcategory: [{ localized_name: 'Fine Dining' }],
      rating: '4.7',
      num_reviews: '5210',
      price_level: '$$$$',
      cuisine: [{ localized_name: 'French' }, { localized_name: 'Seafood' }],
      amenities: ['Reservations', 'Wheelchair Accessible'],
      features: [],
      awards: [{ award_type: 'Travelers Choice', year: '2026', display_name: 'Best Fine Dining' }],
      phone: '+1 212-554-1515',
      ranking_data: { ranking_string: '#8 of 12,000 restaurants in NYC' },
    }));

    const out = await runPlaceDetails({ locationId: '60763' }, ctx, {
      fetch: fetcher,
    } as PlaceDetailsDeps);
    expect(out.name).toBe('Le Bernardin');
    expect(out.rating).toBe(4.7);
    expect(out.cuisines).toEqual(['French', 'Seafood']);
    expect(out.awards).toHaveLength(1);
    expect(out.share.title).toContain('Le Bernardin');
    expect(out.share.title).toContain('4.7★');
    expect(out.share.primaryCta?.href).toContain('tripadvisor.com');
  });

  test('returns error payload when helper rejects', async () => {
    const fetcher: FetchSig = (async () => {
      throw new X402Error('platform 24h cap exceeded', 'platform_cap');
    }) as FetchSig;
    const out = await runPlaceDetails({ locationId: 'foo' }, ctx, {
      fetch: fetcher,
    } as PlaceDetailsDeps);
    expect(out.error).toContain('platform_cap');
    expect(out.share.title).toContain('unavailable');
  });
});
