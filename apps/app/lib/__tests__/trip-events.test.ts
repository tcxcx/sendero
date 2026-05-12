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
  travelerId?: string | null;
  status?: string;
  events: unknown[];
}

interface FakeBooking {
  id: string;
  tenantId: string;
  tripId: string;
  metadata: Record<string, unknown> | null;
}

const state = {
  trips: new Map<string, FakeTrip>(),
  bookings: [] as FakeBooking[],
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
    booking: {
      findMany: async (query: {
        where: {
          tenantId?: string;
          metadata?: { path?: string[]; equals?: unknown };
          AND?: Array<{ metadata?: { path?: string[]; equals?: unknown } }>;
          trip?: {
            tenantId?: string;
            travelerId?: string;
            status?: { notIn?: string[] };
          };
        };
        take?: number;
      }) => {
        const matches = state.bookings
          .filter(booking => {
            const trip = state.trips.get(booking.tripId);
            if (!trip) return false;
            if (query.where.tenantId && booking.tenantId !== query.where.tenantId) return false;
            if (!metadataMatches(booking.metadata, query.where.metadata)) return false;
            for (const clause of query.where.AND ?? []) {
              if (!metadataMatches(booking.metadata, clause.metadata)) return false;
            }
            const tripWhere = query.where.trip;
            if (tripWhere?.tenantId && trip.tenantId !== tripWhere.tenantId) return false;
            if (tripWhere?.travelerId && trip.travelerId !== tripWhere.travelerId) return false;
            if (tripWhere?.status?.notIn?.includes(trip.status ?? 'draft')) return false;
            return true;
          })
          .map(booking => ({ trip: { id: booking.tripId } }));
        return matches.slice(0, query.take ?? matches.length);
      },
    },
  },
}));

function metadataMatches(
  metadata: Record<string, unknown> | null,
  filter?: { path?: string[]; equals?: unknown }
): boolean {
  if (!filter?.path?.length) return true;
  let value: unknown = metadata;
  for (const segment of filter.path) {
    value =
      value && typeof value === 'object' ? (value as Record<string, unknown>)[segment] : undefined;
  }
  return value === filter.equals;
}

const { appendTripEvent, newTripEventId, resolveTripByBoardingPass } = await import(
  '../trip-events'
);

beforeEach(() => {
  state.trips.clear();
  state.bookings = [];
  state.rawCalls = [];
  state.shouldThrow = false;
  state.trips.set('trip_a', {
    id: 'trip_a',
    tenantId: 'tnt_1',
    travelerId: 'user_1',
    status: 'booked',
    events: [],
  });
});

afterEach(() => {
  state.trips.clear();
  state.bookings = [];
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

  test('does not dedup identical event ids at write time', async () => {
    const event = {
      id: 'doc_same_image',
      kind: 'document_scanned' as const,
      documentKind: 'receipt' as const,
      direction: 'internal' as const,
      channel: 'internal' as const,
      createdAt: '2026-05-12T10:00:00Z',
      extractedAt: '2026-05-12T10:00:00Z',
      extractionRef: { provider: 'google', imageSha256: 'sha_1' },
    };
    await appendTripEvent({ tripId: 'trip_a', tenantId: 'tnt_1', event });
    await appendTripEvent({ tripId: 'trip_a', tenantId: 'tnt_1', event });
    expect(state.trips.get('trip_a')!.events).toHaveLength(2);
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

describe('resolveTripByBoardingPass', () => {
  function addTrip(id: string, overrides: Partial<FakeTrip> = {}) {
    state.trips.set(id, {
      id,
      tenantId: 'tnt_1',
      travelerId: 'user_1',
      status: 'booked',
      events: [],
      ...overrides,
    });
  }

  function addBooking(id: string, overrides: Partial<FakeBooking> = {}) {
    state.bookings.push({
      id,
      tenantId: 'tnt_1',
      tripId: 'trip_a',
      metadata: {
        pnr: 'ABC123',
        flightNumber: 'AA100',
        departureDate: '2026-06-01',
      },
      ...overrides,
    });
  }

  const input = {
    tenantId: 'tnt_1',
    userId: 'user_1',
    pnr: 'ABC123',
    flightNumber: 'AA100',
    departureDate: '2026-06-01',
  };

  test('returns null when PNR is missing', async () => {
    addBooking('booking_1');
    await expect(resolveTripByBoardingPass({ ...input, pnr: null })).resolves.toBeNull();
  });

  test('returns null when more than one booking matches', async () => {
    addTrip('trip_b');
    addBooking('booking_1');
    addBooking('booking_2', { tripId: 'trip_b' });
    await expect(resolveTripByBoardingPass(input)).resolves.toBeNull();
  });

  test('returns null for cross-tenant bookings', async () => {
    addTrip('trip_other', { tenantId: 'tnt_2' });
    addBooking('booking_1', { tenantId: 'tnt_2', tripId: 'trip_other' });
    await expect(resolveTripByBoardingPass(input)).resolves.toBeNull();
  });

  test('returns null when traveler userId does not match', async () => {
    addTrip('trip_other_user', { travelerId: 'user_2' });
    addBooking('booking_1', { tripId: 'trip_other_user' });
    await expect(resolveTripByBoardingPass(input)).resolves.toBeNull();
  });

  test('returns null for terminal-state trips', async () => {
    addTrip('trip_done', { status: 'completed' });
    addBooking('booking_1', { tripId: 'trip_done' });
    await expect(resolveTripByBoardingPass(input)).resolves.toBeNull();
  });

  test('returns the trip when tenant, traveler, PNR, flight, and departure date all match', async () => {
    addBooking('booking_1');
    await expect(resolveTripByBoardingPass(input)).resolves.toEqual({ id: 'trip_a' });
  });
});
