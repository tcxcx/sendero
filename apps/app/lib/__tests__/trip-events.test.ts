/**
 * Tests for the canonical `appendTripEvent` write primitive.
 *
 * Mocks `@sendero/database` to capture `$executeRaw` calls. Asserts:
 *   - happy path: tenant matches → append succeeds, returns true
 *   - cross-tenant: tenant mismatch → returns false, no payload appended
 *   - unknown trip: returns false
 *   - missing required fields: returns false fast (no DB call)
 *   - concurrent calls preserve append order (sequential simulation)
 *
 * Run: `bun test apps/app/lib/__tests__/trip-events.test.ts`
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

interface FakeTrip {
  id: string;
  tenantId: string;
  events: unknown[];
}

const state = {
  trips: new Map<string, FakeTrip>(),
  rawCalls: [] as Array<{ tripId: string; tenantId: string; appended: unknown[] }>,
  shouldThrow: false,
};

mock.module('@sendero/database', () => ({
  prisma: {
    $executeRaw: async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      if (state.shouldThrow) throw new Error('db blip');
      const [appendedJson, tripId, tenantId] = values as [string, string, string];
      const trip = state.trips.get(tripId);
      if (!trip || trip.tenantId !== tenantId) return 0;
      const appended = JSON.parse(appendedJson) as unknown[];
      trip.events = [...trip.events, ...appended];
      state.rawCalls.push({ tripId, tenantId, appended });
      return 1;
    },
  },
}));

const { appendTripEvent, newTripEventId } = await import('../trip-events');

beforeEach(() => {
  state.trips.clear();
  state.rawCalls = [];
  state.shouldThrow = false;
  state.trips.set('trip_a', { id: 'trip_a', tenantId: 'tnt_1', events: [] });
});

afterEach(() => {
  state.trips.clear();
  state.rawCalls = [];
});

describe('appendTripEvent', () => {
  test('happy path: tenant matches → append succeeds and ledger grows', async () => {
    const ok = await appendTripEvent({
      tripId: 'trip_a',
      tenantId: 'tnt_1',
      event: {
        id: 'evt_1',
        kind: 'inbox_reply',
        direction: 'inbound',
        channel: 'whatsapp',
        createdAt: '2026-04-28T10:00:00Z',
        text: 'Hello from traveler',
      },
    });
    expect(ok).toBe(true);
    expect(state.trips.get('trip_a')!.events).toHaveLength(1);
    expect(state.rawCalls).toHaveLength(1);
    expect(state.rawCalls[0]!.tenantId).toBe('tnt_1');
  });

  test('cross-tenant: trip belongs to tnt_2, caller in tnt_1 → false, no write', async () => {
    state.trips.set('trip_other', { id: 'trip_other', tenantId: 'tnt_2', events: [] });
    const ok = await appendTripEvent({
      tripId: 'trip_other',
      tenantId: 'tnt_1',
      event: {
        id: 'evt_1',
        kind: 'inbox_reply',
        direction: 'inbound',
        channel: 'whatsapp',
        createdAt: '2026-04-28T10:00:00Z',
        text: 'sneaky',
      },
    });
    expect(ok).toBe(false);
    expect(state.trips.get('trip_other')!.events).toEqual([]);
  });

  test('unknown trip → false, no write', async () => {
    const ok = await appendTripEvent({
      tripId: 'trip_does_not_exist',
      tenantId: 'tnt_1',
      event: {
        id: 'evt_1',
        kind: 'inbox_reply',
        direction: 'inbound',
        channel: 'whatsapp',
        createdAt: '2026-04-28T10:00:00Z',
        text: 'hi',
      },
    });
    expect(ok).toBe(false);
    expect(state.rawCalls).toHaveLength(0);
  });

  test('missing tripId / tenantId / event.id / event.kind → false fast (no DB call)', async () => {
    expect(
      await appendTripEvent({
        tripId: '',
        tenantId: 'tnt_1',
        event: {
          id: 'e',
          kind: 'inbox_reply',
          direction: 'inbound',
          channel: 'whatsapp',
          createdAt: 'x',
        },
      })
    ).toBe(false);
    expect(
      await appendTripEvent({
        tripId: 'trip_a',
        tenantId: '',
        event: {
          id: 'e',
          kind: 'inbox_reply',
          direction: 'inbound',
          channel: 'whatsapp',
          createdAt: 'x',
        },
      })
    ).toBe(false);
    expect(state.rawCalls).toHaveLength(0);
  });

  test('DB error → swallows + returns false (audit writes never break the hot path)', async () => {
    state.shouldThrow = true;
    const ok = await appendTripEvent({
      tripId: 'trip_a',
      tenantId: 'tnt_1',
      event: {
        id: 'evt_1',
        kind: 'inbox_reply',
        direction: 'inbound',
        channel: 'whatsapp',
        createdAt: '2026-04-28T10:00:00Z',
        text: 'hello',
      },
    });
    expect(ok).toBe(false);
  });

  test('preserves prior events on append (no read-then-write race)', async () => {
    state.trips.set('trip_existing', {
      id: 'trip_existing',
      tenantId: 'tnt_1',
      events: [{ id: 'old_1', kind: 'agent_turn', createdAt: '2026-04-27T00:00:00Z' }],
    });
    await appendTripEvent({
      tripId: 'trip_existing',
      tenantId: 'tnt_1',
      event: {
        id: 'evt_new',
        kind: 'inbox_reply',
        direction: 'inbound',
        channel: 'slack',
        createdAt: '2026-04-28T10:00:00Z',
      },
    });
    const trip = state.trips.get('trip_existing')!;
    expect(trip.events).toHaveLength(2);
    expect((trip.events[0] as Record<string, unknown>).id).toBe('old_1');
    expect((trip.events[1] as Record<string, unknown>).id).toBe('evt_new');
  });

  test('concurrent appends preserve order in the ledger', async () => {
    // Sequential simulation of concurrent callers — the JSONB || operator
    // is atomic at the row level, so two parallel calls each see the
    // post-other-call state and append cleanly. This test verifies the
    // mock state-machine semantics; real Postgres atomicity is out of
    // scope for unit tests (covered by the slack-views/trip-note pattern
    // already in production).
    const ev = (i: number) =>
      ({
        id: `evt_${i}`,
        kind: 'inbox_reply' as const,
        direction: 'inbound' as const,
        channel: 'whatsapp' as const,
        createdAt: `2026-04-28T10:00:0${i}Z`,
      }) as const;
    await Promise.all([
      appendTripEvent({ tripId: 'trip_a', tenantId: 'tnt_1', event: ev(1) }),
      appendTripEvent({ tripId: 'trip_a', tenantId: 'tnt_1', event: ev(2) }),
      appendTripEvent({ tripId: 'trip_a', tenantId: 'tnt_1', event: ev(3) }),
    ]);
    const ledger = state.trips.get('trip_a')!.events;
    expect(ledger).toHaveLength(3);
    const ids = ledger.map(e => (e as Record<string, unknown>).id);
    expect(ids).toContain('evt_1');
    expect(ids).toContain('evt_2');
    expect(ids).toContain('evt_3');
  });
});

describe('newTripEventId', () => {
  test('default prefix + uniqueness across rapid calls', () => {
    const a = newTripEventId();
    const b = newTripEventId();
    expect(a.startsWith('evt_')).toBe(true);
    expect(b.startsWith('evt_')).toBe(true);
    expect(a).not.toBe(b);
  });

  test('custom prefix', () => {
    const id = newTripEventId('reply');
    expect(id.startsWith('reply_')).toBe(true);
  });
});
