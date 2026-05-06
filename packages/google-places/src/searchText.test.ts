/**
 * searchText — request shape + response mapping tests.
 *
 * Hermetic: globalThis.fetch is mocked. No live Places calls.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { searchText } from './searchText';

const realFetch = globalThis.fetch;
const realPlacesKey = process.env.GOOGLE_PLACES_API_KEY;
const realApiKey = process.env.GOOGLE_API_KEY;

interface CapturedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

function installFetchMock(handler: (req: Request) => Response | Promise<Response>): {
  calls: CapturedCall[];
} {
  const calls: CapturedCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = init.headers as Record<string, string>;
      for (const [k, v] of Object.entries(h)) headers[k.toLowerCase()] = String(v);
    }
    calls.push({
      url,
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : '',
    });
    const req = new Request(url, init);
    return handler(req);
  }) as typeof fetch;
  return { calls };
}

beforeEach(() => {
  // Force the env-key resolver to a known value so the wrapper doesn't
  // skip to `places-not-configured` based on the developer's local env.
  process.env.GOOGLE_PLACES_API_KEY = 'test-places-key';
});

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realPlacesKey === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
  else process.env.GOOGLE_PLACES_API_KEY = realPlacesKey;
  if (realApiKey === undefined) delete process.env.GOOGLE_API_KEY;
});

describe('searchText — config gate', () => {
  test('returns available:false with reason when no key configured', async () => {
    delete process.env.GOOGLE_PLACES_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    const result = await searchText({ query: 'specialty coffee Tokyo' });
    expect(result.available).toBe(false);
    expect(result.reason).toBe('places-not-configured');
    expect(result.results).toEqual([]);
  });
});

describe('searchText — request shape', () => {
  test('POSTs to Places (New) with proper headers + JSON body', async () => {
    const { calls } = installFetchMock(
      () =>
        new Response(JSON.stringify({ places: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
    );

    await searchText({
      query: 'specialty coffee Tokyo',
      languageCode: 'en',
      regionCode: 'JP',
      limit: 5,
    });

    expect(calls.length).toBe(1);
    expect(calls[0]?.url).toBe('https://places.googleapis.com/v1/places:searchText');
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.headers['x-goog-api-key']).toBe('test-places-key');
    expect(calls[0]?.headers['x-goog-fieldmask']).toContain('places.editorialSummary');

    const body = JSON.parse(calls[0]?.body ?? '{}');
    expect(body.textQuery).toBe('specialty coffee Tokyo');
    expect(body.maxResultCount).toBe(5);
    expect(body.languageCode).toBe('en');
    expect(body.regionCode).toBe('JP');
  });

  test('clamps limit to [1, 20]', async () => {
    const { calls } = installFetchMock(
      () => new Response(JSON.stringify({ places: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
    );

    await searchText({ query: 'coffee', limit: 99 });
    expect(JSON.parse(calls[0]?.body ?? '{}').maxResultCount).toBe(20);

    await searchText({ query: 'coffee', limit: 0 });
    expect(JSON.parse(calls[1]?.body ?? '{}').maxResultCount).toBe(1);
  });

  test('forwards locationBias when provided', async () => {
    const { calls } = installFetchMock(
      () => new Response(JSON.stringify({ places: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
    );

    await searchText({
      query: 'cafe',
      locationBias: {
        circle: {
          center: { latitude: 35.6895, longitude: 139.6917 },
          radius: 2000,
        },
      },
    });

    const body = JSON.parse(calls[0]?.body ?? '{}');
    expect(body.locationBias?.circle?.radius).toBe(2000);
    expect(body.locationBias?.circle?.center?.latitude).toBe(35.6895);
  });
});

describe('searchText — response mapping', () => {
  test('maps Places (New) response into typed PlacesPlace[]', async () => {
    installFetchMock(
      () =>
        new Response(
          JSON.stringify({
            places: [
              {
                id: 'places/ChIJabc123',
                displayName: { text: 'Mameya Kakeru' },
                formattedAddress: '〒103-0023 Tokyo',
                shortFormattedAddress: 'Nihonbashi, Tokyo',
                nationalPhoneNumber: '03-1234-5678',
                websiteUri: 'https://koffee-mameya.com',
                location: { latitude: 35.6817, longitude: 139.7741 },
                businessStatus: 'OPERATIONAL',
                types: ['cafe', 'food', 'point_of_interest'],
                primaryType: 'cafe',
                priceLevel: 'PRICE_LEVEL_EXPENSIVE',
                rating: 4.7,
                userRatingCount: 412,
                regularOpeningHours: { openNow: true },
                editorialSummary: { text: 'A Tokyo specialty roaster.' },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
    );

    const r = await searchText({ query: 'koffee mameya tokyo' });
    expect(r.available).toBe(true);
    expect(r.results.length).toBe(1);
    const p = r.results[0]!;
    expect(p.placeId).toBe('places/ChIJabc123');
    expect(p.name).toBe('Mameya Kakeru');
    expect(p.priceLevel).toBe('PRICE_LEVEL_EXPENSIVE');
    expect(p.rating).toBe(4.7);
    expect(p.openNow).toBe(true);
    expect(p.editorialSummary).toBe('A Tokyo specialty roaster.');
    expect(p.location).toEqual({ latitude: 35.6817, longitude: 139.7741 });
  });

  test('drops malformed entries (missing id or displayName)', async () => {
    installFetchMock(
      () =>
        new Response(
          JSON.stringify({
            places: [
              { id: 'places/ok', displayName: { text: 'Good' }, types: ['cafe'] },
              { id: 'places/no_name' }, // missing displayName
              { displayName: { text: 'No id' } }, // missing id
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
    );

    const r = await searchText({ query: 'x' });
    expect(r.results.length).toBe(1);
    expect(r.results[0]?.placeId).toBe('places/ok');
  });
});

describe('searchText — error paths', () => {
  test('non-2xx returns reason places-http-<status>', async () => {
    installFetchMock(
      () => new Response('forbidden', { status: 403, headers: { 'content-type': 'text/plain' } })
    );

    const r = await searchText({ query: 'x' });
    expect(r.available).toBe(false);
    expect(r.reason).toBe('places-http-403');
    expect(r.results).toEqual([]);
  });

  test('Places error envelope returns reason places-api-error-<code>', async () => {
    installFetchMock(
      () =>
        new Response(JSON.stringify({ error: { code: 7, message: 'PERMISSION_DENIED' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
    );

    const r = await searchText({ query: 'x' });
    expect(r.available).toBe(false);
    expect(r.reason).toBe('places-api-error-7');
  });
});
