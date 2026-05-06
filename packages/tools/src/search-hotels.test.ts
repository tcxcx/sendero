/**
 * search_hotels handler contract tests.
 *
 * Pinpoints the bug surfaced in production 2026-05-05: handler was
 * passing free-form `input.location` straight to `@sendero/duffel`'s
 * `searchHotels`, which silently fell back to London for any
 * unrecognized city. This test ensures the handler ALWAYS routes
 * through `resolveStayLocation` (Google Geocoding) and forwards
 * `lat,lng` to the duffel wrapper.
 *
 * Mocks both modules so we never hit a real backend.
 */

import { afterEach, beforeAll, describe, expect, mock, test } from 'bun:test';

// ── Mocks BEFORE importing the SUT ─────────────────────────────────

const resolveStayLocationMock = mock(
  async (location: string) => ({
    latitude: -12.0464,
    longitude: -77.0428,
    formattedAddress: `Resolved: ${location}`,
    source: 'geocoded' as const,
  })
);

class LocationNotResolvedError extends Error {
  readonly code = 'location_not_resolved';
  readonly input: string;
  constructor(input: string, cause?: unknown) {
    super(`Could not resolve location "${input}" to coordinates.`);
    this.input = input;
    if (cause) (this as { cause?: unknown }).cause = cause;
  }
}

mock.module('./lib/resolve-stay-location', () => ({
  resolveStayLocation: resolveStayLocationMock,
  LocationNotResolvedError,
}));

const duffelSearchHotelsMock = mock(
  async (params: { location: string }) => [
    {
      id: 'srr_test_1',
      name: 'Test Hotel Lima',
      country: 'PE',
      city: 'Lima',
      stars: 4,
      reviewScore: 8.5,
      photos: ['https://example.com/p.jpg'],
      price: '120.00',
      currency: 'USD',
      cancellation: 'refundable' as const,
      distanceMeters: 1200,
      amenities: ['wifi'],
      _capturedLocation: params.location,
    },
  ]
);

mock.module('@sendero/duffel', () => ({
  searchHotels: duffelSearchHotelsMock,
}));

// ── SUT (must import AFTER mocks) ──────────────────────────────────

let searchHotelsTool: typeof import('./search-hotels').searchHotelsTool;

beforeAll(async () => {
  ({ searchHotelsTool } = await import('./search-hotels'));
});

afterEach(() => {
  resolveStayLocationMock.mockClear();
  duffelSearchHotelsMock.mockClear();
});

describe('search_hotels handler', () => {
  test('routes free-form location through resolveStayLocation, forwards lat,lng to Duffel', async () => {
    const result = await searchHotelsTool.handler!(
      {
        location: 'Lima',
        checkInDate: '2026-05-11',
        checkOutDate: '2026-05-12',
        guests: 1,
        rooms: 1,
      },
      { traveler: { userId: 'u1', tenantId: 'tenant_a' } }
    );

    // Resolver was called once with the raw user input.
    expect(resolveStayLocationMock).toHaveBeenCalledTimes(1);
    expect(resolveStayLocationMock.mock.calls[0]?.[0]).toBe('Lima');

    // Duffel got coordinates, not a city name. This is the load-bearing
    // assertion — the bug was exactly: city name passed through
    // unchanged, duffel wrapper silently routed to London.
    expect(duffelSearchHotelsMock).toHaveBeenCalledTimes(1);
    const params = duffelSearchHotelsMock.mock.calls[0]?.[0] as { location: string };
    expect(params.location).toBe('-12.0464,-77.0428');
    expect(params.location).not.toMatch(/[a-zA-Z]/); // no letters at all

    // Header carries the geocoder's formatted address so the user sees
    // exactly what was searched.
    expect(result.share.title).toContain('Resolved: Lima');
  });

  test('typed LocationNotResolvedError surfaces a clear agent-facing message', async () => {
    resolveStayLocationMock.mockImplementationOnce(async (loc: string) => {
      throw new LocationNotResolvedError(loc);
    });

    await expect(
      searchHotelsTool.handler!(
        {
          location: 'Lugar_Que_No_Existe_X',
          checkInDate: '2026-05-11',
          checkOutDate: '2026-05-12',
          guests: 1,
          rooms: 1,
        },
        { traveler: { userId: 'u1', tenantId: 'tenant_a' } }
      )
    ).rejects.toThrow(/couldn't resolve "Lugar_Que_No_Existe_X"/);

    expect(duffelSearchHotelsMock).not.toHaveBeenCalled();
  });

  test('coords passthrough: "lat,lng" input still goes through resolver (it fast-paths internally)', async () => {
    resolveStayLocationMock.mockImplementationOnce(async () => ({
      latitude: -12.0,
      longitude: -77.0,
      formattedAddress: null, // resolver returns null for raw coord input
      source: 'coords' as const,
    }));

    const result = await searchHotelsTool.handler!(
      {
        location: '-12.0,-77.0',
        checkInDate: '2026-05-11',
        checkOutDate: '2026-05-12',
        guests: 1,
        rooms: 1,
      },
      { traveler: { userId: 'u1', tenantId: 'tenant_a' } }
    );

    expect(resolveStayLocationMock).toHaveBeenCalledTimes(1);
    const params = duffelSearchHotelsMock.mock.calls[0]?.[0] as { location: string };
    expect(params.location).toBe('-12,-77');
    // No formatted address → fall back to the raw input in the header.
    expect(result.share.title).toContain('-12.0,-77.0');
  });
});
