/**
 * track_flight — share-payload mapping tests via direct dependency
 * injection. The x402 helper itself is exercised in
 * `x402-fetch.test.ts`. We avoid `mock.module('./x402-fetch')` because
 * mock.module is process-global in bun and would shadow the real
 * helper for the helper test file too.
 */

import { describe, expect, mock, test } from 'bun:test';

import { runTrackFlight, type TrackFlightDeps } from './track-flight';
import { X402Error } from './x402-fetch';

const ctx = {
  caller: { effectiveKeyType: 'production' as const },
  traveler: { tenantId: 'org_test', userId: 'usr_1' },
};

function makeDeps(impl: TrackFlightDeps['fetch']): TrackFlightDeps {
  return { fetch: impl };
}

describe('track_flight', () => {
  test('happy path — maps FA response into share payload', async () => {
    const fetcher = mock(async () => ({
      data: {
        flights: [
          {
            fa_flight_id: 'AAL100-1733068800-airline-0001',
            ident: 'AAL100',
            ident_iata: 'AA100',
            operator: 'AAL',
            operator_iata: 'AA',
            flight_number: '100',
            origin: { code_iata: 'JFK', name: 'John F. Kennedy International' },
            destination: { code_iata: 'LAX', name: 'Los Angeles International' },
            scheduled_out: '2026-12-01T13:00:00Z',
            estimated_out: '2026-12-01T13:25:00Z',
            scheduled_in: '2026-12-01T19:00:00Z',
            estimated_in: '2026-12-01T19:30:00Z',
            status: 'Taxiing',
            aircraft_type: 'B738',
          },
        ],
      },
      meta: { upstreamUrl: '', paidMicroUsdc: 10_000n, facilitatorResponseHeaders: {} },
    }));

    const out = await runTrackFlight(
      { ident: 'AAL100', max: 3 },
      ctx,
      makeDeps(fetcher as unknown as TrackFlightDeps['fetch'])
    );
    if ('error' in out) throw new Error(`unexpected error: ${out.error}`);

    expect(out.ident).toBe('AAL100');
    expect(out.flights).toHaveLength(1);
    expect(out.flights[0]!.originCode).toBe('JFK');
    expect(out.flights[0]!.destinationCode).toBe('LAX');
    expect(out.flights[0]!.delayMinutesOut).toBe(25);
    expect(out.flights[0]!.delayMinutesIn).toBe(30);
    expect(out.flights[0]!.status).toBe('Taxiing');
    expect(out.flights[0]!.cancelled).toBe(false);

    expect(out.share.title).toContain('+25m delay');
    expect(out.share.body).toContain('JFK → LAX');
    expect(out.share.body).toContain('B738');
    expect(out.share.bullets).toHaveLength(1);
  });

  test('uppercases + URL-encodes the ident', async () => {
    const fetcher = mock(async () => ({
      data: { flights: [] },
      meta: { upstreamUrl: '', paidMicroUsdc: 10_000n, facilitatorResponseHeaders: {} },
    }));
    await runTrackFlight(
      { ident: 'aa100', max: 3 },
      ctx,
      makeDeps(fetcher as unknown as TrackFlightDeps['fetch'])
    );
    const url = fetcher.mock.calls[0]![0] as string;
    expect(url).toBe('https://stabletravel.dev/api/flightaware/flights/AA100');
  });

  test('caps results at `max`', async () => {
    const fetcher = mock(async () => ({
      data: {
        flights: Array.from({ length: 10 }, (_, i) => ({
          ident: 'AA100',
          status: 'Scheduled',
          flight_number: String(100 + i),
        })),
      },
      meta: { upstreamUrl: '', paidMicroUsdc: 10_000n, facilitatorResponseHeaders: {} },
    }));
    const out = await runTrackFlight(
      { ident: 'AA100', max: 2 },
      ctx,
      makeDeps(fetcher as unknown as TrackFlightDeps['fetch'])
    );
    if ('error' in out) throw new Error('unexpected error');
    expect(out.flights).toHaveLength(2);
  });

  test('handles empty FA response with a clean share message', async () => {
    const fetcher = mock(async () => ({
      data: { flights: [] },
      meta: { upstreamUrl: '', paidMicroUsdc: 10_000n, facilitatorResponseHeaders: {} },
    }));
    const out = await runTrackFlight(
      { ident: 'NOPE', max: 3 },
      ctx,
      makeDeps(fetcher as unknown as TrackFlightDeps['fetch'])
    );
    if ('error' in out) throw new Error('unexpected error');
    expect(out.flights).toHaveLength(0);
    expect(out.share.title).toContain('NOPE');
    expect(out.share.bullets).toHaveLength(0);
  });

  test('returns { error } payload when x402 helper rejects with X402Error', async () => {
    const fetcher = mock(async () => {
      throw new X402Error('Treasury Base USDC balance low', 'treasury_balance_low');
    });
    const out = await runTrackFlight(
      { ident: 'AA100', max: 3 },
      ctx,
      makeDeps(fetcher as unknown as TrackFlightDeps['fetch'])
    );
    if (!('error' in out)) throw new Error('expected error payload');
    expect(out.error).toContain('treasury_balance_low');
  });

  test('detects cancelled status', async () => {
    const fetcher = mock(async () => ({
      data: {
        flights: [
          {
            ident: 'AA100',
            cancelled: true,
            origin: { code_iata: 'JFK' },
            destination: { code_iata: 'LAX' },
            status: 'Scheduled',
          },
        ],
      },
      meta: { upstreamUrl: '', paidMicroUsdc: 10_000n, facilitatorResponseHeaders: {} },
    }));
    const out = await runTrackFlight(
      { ident: 'AA100', max: 3 },
      ctx,
      makeDeps(fetcher as unknown as TrackFlightDeps['fetch'])
    );
    if ('error' in out) throw new Error('unexpected error');
    expect(out.flights[0]!.status).toBe('Cancelled');
    expect(out.flights[0]!.cancelled).toBe(true);
  });
});
