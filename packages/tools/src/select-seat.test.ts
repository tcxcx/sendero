/**
 * select_seat unit tests.
 *
 * Stubs deps so we don't touch Prisma; verifies the staging contract:
 *   - new selection is appended to Trip.metadata.pendingAncillaries
 *   - re-staging a different seat for the same passenger replaces, not duplicates
 *   - staging for a different passenger keeps both
 *   - other metadata keys + other offers are preserved
 *   - missing trip throws
 */

import { describe, expect, test } from 'bun:test';

import {
  runSelectSeat,
  TripNotFoundError,
  type SelectSeatDeps,
  type SelectSeatInput,
} from './select-seat';

interface InMemoryDeps extends SelectSeatDeps {
  store: Record<string, Record<string, unknown> | null>;
}

function memoryDeps(initial: Record<string, Record<string, unknown> | null> = {}): InMemoryDeps {
  const store: Record<string, Record<string, unknown> | null> = { ...initial };
  return {
    store,
    async loadTripMetadata(tripId: string) {
      if (!(tripId in store)) return null;
      const v = store[tripId];
      return v ? { ...v } : {};
    },
    async saveTripMetadata(tripId: string, metadata: Record<string, unknown>) {
      store[tripId] = metadata;
    },
  };
}

function baseInput(overrides: Partial<SelectSeatInput> = {}): SelectSeatInput {
  return {
    tripId: 'trp_1',
    offerId: 'off_1',
    passengerId: 'pax_1',
    seatServiceId: 'sea_001',
    designator: '12A',
    price: '24.00',
    currency: 'USD',
    ...overrides,
  };
}

describe('select_seat', () => {
  test('stages first seat selection', async () => {
    const deps = memoryDeps({ trp_1: {} });

    const result = await runSelectSeat(baseInput(), deps);

    expect(result.staged.seats).toHaveLength(1);
    expect(result.staged.seats[0]?.designator).toBe('12A');
    const stored = deps.store.trp_1 as { pendingAncillaries: { flight: Record<string, unknown> } };
    expect(stored.pendingAncillaries.flight).toHaveProperty('off_1');
  });

  test('replaces prior seat for same (passenger, designator)', async () => {
    const deps = memoryDeps({ trp_1: {} });

    await runSelectSeat(baseInput({ seatServiceId: 'sea_old' }), deps);
    const result = await runSelectSeat(baseInput({ seatServiceId: 'sea_new' }), deps);

    expect(result.staged.seats).toHaveLength(1);
    expect(result.staged.seats[0]?.serviceId).toBe('sea_new');
  });

  test('keeps separate selections for different passengers', async () => {
    const deps = memoryDeps({ trp_1: {} });

    await runSelectSeat(baseInput({ passengerId: 'pax_1' }), deps);
    const result = await runSelectSeat(
      baseInput({ passengerId: 'pax_2', designator: '12B', seatServiceId: 'sea_b' }),
      deps
    );

    expect(result.staged.seats).toHaveLength(2);
    expect(result.staged.seats.map(s => s.passengerId).sort()).toEqual(['pax_1', 'pax_2']);
  });

  test('preserves unrelated metadata and other offers', async () => {
    const deps = memoryDeps({
      trp_1: {
        unrelated: 'keep-me',
        pendingAncillaries: {
          flight: {
            off_other: { seats: [{ passengerId: 'p', serviceId: 's', stagedAt: 'x' }], bags: [] },
          },
        },
      },
    });

    await runSelectSeat(baseInput(), deps);

    const stored = deps.store.trp_1 as Record<string, unknown> & {
      pendingAncillaries: { flight: Record<string, unknown> };
    };
    expect(stored.unrelated).toBe('keep-me');
    expect(stored.pendingAncillaries.flight).toHaveProperty('off_other');
    expect(stored.pendingAncillaries.flight).toHaveProperty('off_1');
  });

  test('throws TripNotFoundError when trip missing', async () => {
    const deps = memoryDeps({});

    await expect(runSelectSeat(baseInput({ tripId: 'missing' }), deps)).rejects.toBeInstanceOf(
      TripNotFoundError
    );
  });
});
