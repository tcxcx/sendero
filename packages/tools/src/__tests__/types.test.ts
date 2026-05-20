import type { ToolContext, TripEvent } from '../types';
import { describe, expect, test } from 'bun:test';

function acceptsToolContext(ctx: ToolContext): ToolContext {
  return ctx;
}

const event: TripEvent = {
  id: 'doc_sha',
  kind: 'document_scanned',
  direction: 'internal',
  channel: 'internal',
  createdAt: '2026-05-12T10:00:00Z',
  documentKind: 'boarding_pass',
};

describe('ToolContext trip-event deps', () => {
  test('optional deps compile when undefined', () => {
    const ctx = acceptsToolContext({
      traveler: { userId: 'user_1', tenantId: 'tnt_1' },
    });
    expect(ctx.appendTripEvent).toBeUndefined();
    expect(ctx.resolveTripByBoardingPass).toBeUndefined();
    expect(ctx.readTripEvents).toBeUndefined();
  });

  test('optional deps compile when populated', async () => {
    const ctx = acceptsToolContext({
      appendTripEvent: async args => args.event.id === event.id,
      resolveTripByBoardingPass: async args =>
        args.pnr && args.flightNumber && args.departureDate ? { id: 'trip_1' } : null,
      readTripEvents: async () => [event],
    });

    await expect(
      ctx.appendTripEvent?.({ tripId: 'trip_1', tenantId: 'tnt_1', event })
    ).resolves.toBe(true);
    await expect(
      ctx.resolveTripByBoardingPass?.({
        tenantId: 'tnt_1',
        userId: 'user_1',
        pnr: 'ABC123',
        flightNumber: 'AA100',
        departureDate: '2026-06-01',
      })
    ).resolves.toEqual({ id: 'trip_1' });
    await expect(ctx.readTripEvents?.({ tripId: 'trip_1', tenantId: 'tnt_1' })).resolves.toEqual([
      event,
    ]);
  });
});
