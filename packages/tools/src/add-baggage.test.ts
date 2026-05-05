/**
 * add_baggage unit tests.
 *
 * Stubs deps to avoid Prisma. Verifies:
 *   - bag is added with quantity (default 1, override allowed)
 *   - re-staging same (passenger, serviceId) overwrites quantity
 *   - distinct serviceIds for the same passenger coexist
 *   - other metadata preserved
 *   - missing trip throws
 */

import { describe, expect, test } from 'bun:test';

import {
  runAddBaggage,
  TripNotFoundError,
  type AddBaggageDeps,
  type AddBaggageInput,
} from './add-baggage';

interface InMemoryDeps extends AddBaggageDeps {
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

function baseInput(overrides: Partial<AddBaggageInput> = {}): AddBaggageInput {
  return {
    tripId: 'trp_1',
    offerId: 'off_1',
    passengerId: 'pax_1',
    bagServiceId: 'bag_001',
    quantity: 1,
    label: 'Checked bag',
    price: '45.00',
    currency: 'USD',
    ...overrides,
  };
}

describe('add_baggage', () => {
  test('stages first bag', async () => {
    const deps = memoryDeps({ trp_1: {} });

    const result = await runAddBaggage(baseInput(), deps);

    expect(result.staged.bags).toHaveLength(1);
    expect(result.staged.bags[0]?.serviceId).toBe('bag_001');
    expect(result.staged.bags[0]?.quantity).toBe(1);
  });

  test('re-staging same (passenger, serviceId) overwrites quantity', async () => {
    const deps = memoryDeps({ trp_1: {} });

    await runAddBaggage(baseInput({ quantity: 1 }), deps);
    const result = await runAddBaggage(baseInput({ quantity: 3 }), deps);

    expect(result.staged.bags).toHaveLength(1);
    expect(result.staged.bags[0]?.quantity).toBe(3);
  });

  test('distinct serviceIds for the same passenger coexist (carry-on + checked)', async () => {
    const deps = memoryDeps({ trp_1: {} });

    await runAddBaggage(baseInput({ bagServiceId: 'bag_carry', label: 'Carry-on' }), deps);
    const result = await runAddBaggage(
      baseInput({ bagServiceId: 'bag_checked', label: 'Checked' }),
      deps
    );

    expect(result.staged.bags).toHaveLength(2);
    expect(result.staged.bags.map(b => b.serviceId).sort()).toEqual(['bag_carry', 'bag_checked']);
  });

  test('preserves unrelated metadata', async () => {
    const deps = memoryDeps({
      trp_1: {
        unrelated: { keep: true },
      },
    });

    await runAddBaggage(baseInput(), deps);

    const stored = deps.store.trp_1 as { unrelated?: { keep?: boolean } };
    expect(stored.unrelated?.keep).toBe(true);
  });

  test('throws TripNotFoundError when trip missing', async () => {
    const deps = memoryDeps({});

    await expect(runAddBaggage(baseInput({ tripId: 'missing' }), deps)).rejects.toBeInstanceOf(
      TripNotFoundError
    );
  });
});
