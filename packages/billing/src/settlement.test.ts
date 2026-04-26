/**
 * Track B7 unit tests — settlement event observer.
 *
 * The persisters are pure orchestrators over an injected
 * `SettlementStore`, so the tests mock the store and verify:
 *   - V2 event with a known booking → 1 Settlement + 3 Legs (supplier
 *     + agency + fee), all sharing the same txHash.
 *   - V2 event with `agencyAmount === 0` → 2 legs (supplier + fee),
 *     no agency leg.
 *   - V1 event → 1 Settlement + 2 Legs (supplier + fee), no agency.
 *   - Orphan event (no Booking) → SecurityAlert recorded, no
 *     Settlement, persister returns `{ orphan: true }`.
 *   - Idempotency — same event twice returns the existing settlement,
 *     no duplicate legs.
 */

import { describe, expect, test } from 'bun:test';
import {
  persistSettlementFromV1Event,
  persistSettlementFromV2Event,
  type NewSettlementInput,
  type SecurityAlertInput,
  type SettlementBookingRow,
  type SettlementStore,
} from './settlement';

// ─── Fixtures ─────────────────────────────────────────────────────────

const BOOKING_HEX = `0x${'1'.repeat(64)}` as const;
const VENDOR = `0x${'a'.repeat(40)}` as const;
const AGENCY = `0x${'b'.repeat(40)}` as const;
const TX = `0x${'c'.repeat(64)}` as const;

const USD = (dollars: number): bigint => BigInt(Math.round(dollars * 1_000_000));

interface MockState {
  bookings: Map<string, SettlementBookingRow>;
  settlements: NewSettlementInput[];
  existing: Map<string, { id: string }>;
  alerts: SecurityAlertInput[];
  bookingLookupError?: Error;
}

function makeStore(state: MockState): SettlementStore {
  let nextId = 1;
  return {
    async findBookingByExternalId(externalId) {
      if (state.bookingLookupError) throw state.bookingLookupError;
      return state.bookings.get(externalId) ?? null;
    },
    async findExistingSettlement({ bookingId, chain, txHash }) {
      const key = `${bookingId}:${chain}:${txHash}`;
      return state.existing.get(key) ?? null;
    },
    async createSettlementWithLegs(input) {
      state.settlements.push(input);
      const id = `set_${nextId++}`;
      // Stamp existing index so a follow-up call dedupes correctly.
      const key = `${input.bookingId}:${input.chain}:${input.txHash}`;
      state.existing.set(key, { id });
      return { id, legCount: input.legs.length };
    },
    async recordSecurityAlert(input) {
      state.alerts.push(input);
    },
  };
}

function makeState(seed?: Partial<MockState>): MockState {
  const bookings = new Map<string, SettlementBookingRow>();
  bookings.set(BOOKING_HEX, {
    id: 'bk_test_001',
    tenantId: 'ten_test',
    tripId: 'trip_test',
    costMicroUsdc: USD(1_000),
  });
  return {
    bookings,
    settlements: [],
    existing: new Map(),
    alerts: [],
    ...seed,
  };
}

// ─── V2 happy path ────────────────────────────────────────────────────

describe('persistSettlementFromV2Event', () => {
  test('valid V2 event → 1 Settlement + 3 Legs sharing txHash', async () => {
    const state = makeState();
    const store = makeStore(state);
    const result = await persistSettlementFromV2Event({
      store,
      event: {
        bookingId: BOOKING_HEX,
        vendor: VENDOR,
        vendorAmount: USD(1_000),
        agencyAddress: AGENCY,
        agencyAmount: USD(110),
        feeAmount: 5_217_000n,
      },
      txHash: TX,
      blockNumber: 42n,
      chain: 'arc-testnet',
    });

    expect(result.settlementId).toBe('set_1');
    expect(result.legCount).toBe(3);
    expect(result.alreadyExisted).toBeUndefined();
    expect(result.orphan).toBeUndefined();

    expect(state.settlements.length).toBe(1);
    const settlement = state.settlements[0];
    expect(settlement.bookingId).toBe('bk_test_001');
    expect(settlement.tenantId).toBe('ten_test');
    expect(settlement.tripId).toBe('trip_test');
    expect(settlement.grossMicroUsdc).toBe(USD(1_000) + USD(110) + 5_217_000n);
    expect(settlement.costMicroUsdc).toBe(USD(1_000));
    expect(settlement.tenantTakeMicroUsdc).toBe(USD(110));
    expect(settlement.senderoTakeMicroUsdc).toBe(5_217_000n);
    expect(settlement.chain).toBe('arc-testnet');
    expect(settlement.status).toBe('confirmed');
    expect(settlement.confirmedAt).toBeInstanceOf(Date);

    // Three legs, ordered supplier (0) → agency (1) → fee (2), all
    // carrying the same txHash because the on-chain split is atomic.
    expect(settlement.legs.length).toBe(3);
    expect(settlement.legs[0]).toEqual({
      kind: 'supplier',
      toAddress: VENDOR,
      amountMicroUsdc: USD(1_000),
      txHash: TX,
      index: 0,
    });
    expect(settlement.legs[1]).toEqual({
      kind: 'agency',
      toAddress: AGENCY,
      amountMicroUsdc: USD(110),
      txHash: TX,
      index: 1,
    });
    expect(settlement.legs[2].kind).toBe('fee');
    expect(settlement.legs[2].amountMicroUsdc).toBe(5_217_000n);
    expect(settlement.legs[2].txHash).toBe(TX);
    expect(settlement.legs[2].index).toBe(2);
  });

  test('V2 event with zero agencyAmount → 2 legs (supplier + fee)', async () => {
    const state = makeState();
    const store = makeStore(state);
    const result = await persistSettlementFromV2Event({
      store,
      event: {
        bookingId: BOOKING_HEX,
        vendor: VENDOR,
        vendorAmount: USD(1_000),
        agencyAddress: AGENCY,
        agencyAmount: 0n,
        feeAmount: 5_000_000n,
      },
      txHash: TX,
      blockNumber: 7n,
      chain: 'arc-testnet',
    });
    expect(result.legCount).toBe(2);
    const legs = state.settlements[0].legs;
    expect(legs.map(l => l.kind)).toEqual(['supplier', 'fee']);
    expect(state.settlements[0].tenantTakeMicroUsdc).toBeNull();
  });
});

// ─── V1 path ──────────────────────────────────────────────────────────

describe('persistSettlementFromV1Event', () => {
  test('legacy V1 event → 1 Settlement + 2 Legs (no agency)', async () => {
    const state = makeState();
    const store = makeStore(state);
    const result = await persistSettlementFromV1Event({
      store,
      event: {
        bookingId: BOOKING_HEX,
        vendor: VENDOR,
        vendorAmount: USD(800),
        feeAmount: 4_000_000n,
      },
      txHash: TX,
      blockNumber: 5n,
      chain: 'arc-testnet',
    });
    expect(result.legCount).toBe(2);
    const settlement = state.settlements[0];
    expect(settlement.grossMicroUsdc).toBe(USD(800) + 4_000_000n);
    expect(settlement.tenantTakeMicroUsdc).toBeNull();
    expect(settlement.legs.map(l => l.kind)).toEqual(['supplier', 'fee']);
  });
});

// ─── Orphan event ─────────────────────────────────────────────────────

describe('orphan events', () => {
  test('missing Booking → SecurityAlert + no Settlement, never throws', async () => {
    const state = makeState({ bookings: new Map() });
    const store = makeStore(state);
    const result = await persistSettlementFromV2Event({
      store,
      event: {
        bookingId: BOOKING_HEX,
        vendor: VENDOR,
        vendorAmount: USD(500),
        agencyAddress: AGENCY,
        agencyAmount: USD(50),
        feeAmount: 2_500_000n,
      },
      txHash: TX,
      blockNumber: 99n,
      chain: 'arc-mainnet',
    });
    expect(result.settlementId).toBeNull();
    expect(result.legCount).toBe(0);
    expect(result.orphan).toBe(true);
    expect(state.settlements.length).toBe(0);
    expect(state.alerts.length).toBe(1);
    expect(state.alerts[0].kind).toBe('settlement_orphan');
    expect(state.alerts[0].severity).toBe('medium');
    expect(state.alerts[0].payload.bookingId).toBe(BOOKING_HEX);
    expect(state.alerts[0].payload.txHash).toBe(TX);
    expect(state.alerts[0].payload.chain).toBe('arc-mainnet');
  });

  test('booking-lookup throws → still treated as orphan, never propagates', async () => {
    const state = makeState({
      bookings: new Map(),
      bookingLookupError: new Error('Connection lost'),
    });
    const store = makeStore(state);
    const result = await persistSettlementFromV1Event({
      store,
      event: {
        bookingId: BOOKING_HEX,
        vendor: VENDOR,
        vendorAmount: USD(100),
        feeAmount: 500_000n,
      },
      txHash: TX,
      blockNumber: 1n,
      chain: 'arc-testnet',
    });
    expect(result.orphan).toBe(true);
    expect(state.alerts.length).toBe(1);
  });
});

// ─── Idempotency ──────────────────────────────────────────────────────

describe('idempotency', () => {
  test('same event twice → returns existing settlement, no duplicate legs', async () => {
    const state = makeState();
    const store = makeStore(state);
    const args = {
      store,
      event: {
        bookingId: BOOKING_HEX,
        vendor: VENDOR,
        vendorAmount: USD(1_000),
        agencyAddress: AGENCY,
        agencyAmount: USD(110),
        feeAmount: 5_217_000n,
      },
      txHash: TX,
      blockNumber: 42n,
      chain: 'arc-testnet',
    };
    const first = await persistSettlementFromV2Event(args);
    expect(first.settlementId).toBe('set_1');
    expect(first.legCount).toBe(3);

    const second = await persistSettlementFromV2Event(args);
    expect(second.settlementId).toBe('set_1');
    expect(second.alreadyExisted).toBe(true);
    expect(second.legCount).toBe(0);

    // Only one Settlement actually written.
    expect(state.settlements.length).toBe(1);
  });
});
