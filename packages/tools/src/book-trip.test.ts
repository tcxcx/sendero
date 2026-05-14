/**
 * book_trip orchestrator unit tests.
 *
 * Covers the state-machine + load-bearing guards on `book_trip`:
 *
 *   - Tenant gate (split-ticket opt-in).
 *   - Provenance check (recentSplitTicketSearch stamp, TTL, searchId
 *     match, offer-id set membership).
 *   - Pre-hold validation (route continuity + min-layover with tenant
 *     override clamped to platform hard floor).
 *   - Peek retry helper (parallel → retry → sequential → fail).
 *   - Phase-1 rollback on hold failure.
 *   - Phase-2 partial-paid with persistent state + unpaid-hold cleanup.
 *   - All-paid happy path.
 *
 * Mock strategy: bun:test `mock.module()` for `@sendero/duffel` and a
 * pass-through stub of `@sendero/database` (preserving real enum
 * re-exports for sibling test files in the shared module graph).
 *
 * Stream M of the PR #54 v2 follow-up motion. No production code in
 * `book-trip.ts` is modified — every gate is exercised through the
 * existing public handler signature.
 */

import { afterEach, beforeAll, describe, expect, mock, test } from 'bun:test';

// ── Mocks BEFORE importing the SUT ─────────────────────────────────

const createHoldOrderMock = mock(async (_params: unknown) => ({
  orderId: 'ord_default',
  bookingReference: 'PNR000',
  totalAmount: '100.00',
  totalCurrency: 'USD',
  paymentRequiredBy: '2026-06-01T00:00:00Z',
  services: [] as Array<{ id: string; quantity: number }>,
  segments: [] as Array<{
    origin: { iata: string };
    destination: { iata: string };
    departureAt: string;
    arrivalAt: string;
  }>,
  originIata: null as string | null,
  destinationIata: null as string | null,
  destinationIso2: [] as string[],
  startDate: null as string | null,
  endDate: null as string | null,
  rawDuffel: null as Record<string, unknown> | null,
}));

const payFromBalanceMock = mock(async (_orderId: string, _opts?: unknown) => ({}));
const createOrderCancellationMock = mock(async (_orderId: string) => ({ id: 'cxl_q_1' }));
const confirmOrderCancellationMock = mock(async (_quoteId: string) => ({}));
const peekOfferSegmentsMock = mock(async (offerId: string) => ({
  offerId,
  originIata: 'JFK',
  destinationIata: 'LHR',
  departureAt: '2026-06-01T18:00:00Z',
  arrivalAt: '2026-06-02T06:00:00Z',
  segments: [] as unknown[],
}));

mock.module('@sendero/duffel', () => ({
  createHoldOrder: createHoldOrderMock,
  payFromBalance: payFromBalanceMock,
  createOrderCancellation: createOrderCancellationMock,
  confirmOrderCancellation: confirmOrderCancellationMock,
  peekOfferSegments: peekOfferSegmentsMock,
}));

// Pass through the rest of @sendero/database so sibling test files
// importing Prisma / MeterPayerType / etc. still resolve. Only `prisma`
// is stubbed.
const tripFindUniqueMock = mock(
  async (_args: unknown): Promise<{ metadata: unknown } | null> => null
);
const tripUpdateMock = mock(async (args: unknown) => args as unknown);
const tenantFindUniqueMock = mock(
  async (_args: unknown): Promise<{ metadata: unknown } | null> => ({
    metadata: { flights: { allowSplitTicket: true } },
  })
);
const bookingCreateMock = mock(async (_args: unknown) => ({ id: 'bkg_test_1' }));

const realDb = await import('@sendero/database');
mock.module('@sendero/database', () => ({
  ...realDb,
  prisma: {
    trip: { findUnique: tripFindUniqueMock, update: tripUpdateMock },
    tenant: { findUnique: tenantFindUniqueMock },
    booking: { create: bookingCreateMock },
  },
}));

// ── SUT (must import AFTER mocks) ──────────────────────────────────

let bookTripTool: typeof import('./book-trip').bookTripTool;
beforeAll(async () => {
  ({ bookTripTool } = await import('./book-trip'));
});

afterEach(() => {
  createHoldOrderMock.mockClear();
  payFromBalanceMock.mockClear();
  createOrderCancellationMock.mockClear();
  confirmOrderCancellationMock.mockClear();
  peekOfferSegmentsMock.mockClear();
  tripFindUniqueMock.mockClear();
  tripUpdateMock.mockClear();
  tenantFindUniqueMock.mockClear();
  bookingCreateMock.mockClear();

  // Reset default implementations between tests.
  createHoldOrderMock.mockImplementation(async (params: unknown) => {
    const p = params as { offerId: string; idempotencyKey?: string };
    return {
      orderId: `ord_${p.offerId}`,
      bookingReference: `PNR_${p.offerId}`,
      totalAmount: '100.00',
      totalCurrency: 'USD',
      paymentRequiredBy: '2026-06-01T00:00:00Z',
      services: [],
      segments: [
        {
          origin: { iata: 'JFK' },
          destination: { iata: 'LHR' },
          departureAt: '2026-06-01T18:00:00Z',
          arrivalAt: '2026-06-02T06:00:00Z',
        },
      ],
      originIata: 'JFK',
      destinationIata: 'LHR',
      destinationIso2: ['GB'],
      startDate: '2026-06-01',
      endDate: '2026-06-02',
      rawDuffel: null,
    };
  });
  payFromBalanceMock.mockImplementation(async () => ({}));
  createOrderCancellationMock.mockImplementation(async () => ({ id: 'cxl_q_1' }));
  confirmOrderCancellationMock.mockImplementation(async () => ({}));
  peekOfferSegmentsMock.mockImplementation(async (offerId: string) => ({
    offerId,
    originIata: 'JFK',
    destinationIata: 'LHR',
    departureAt: '2026-06-01T18:00:00Z',
    arrivalAt: '2026-06-02T06:00:00Z',
    segments: [],
  }));
  tripFindUniqueMock.mockImplementation(async () => null);
  tripUpdateMock.mockImplementation(async (args: unknown) => args as unknown);
  tenantFindUniqueMock.mockImplementation(async () => ({
    metadata: { flights: { allowSplitTicket: true } },
  }));
  bookingCreateMock.mockImplementation(async () => ({ id: 'bkg_test_1' }));
});

// ── Fixture helpers ────────────────────────────────────────────────

const baseCtx = {
  traveler: { tenantId: 'ten_test', userId: 'usr_alice' },
} as const;

const validSearchId = '11111111-1111-4111-8111-111111111111';

const passenger = {
  name: 'Alice Test',
  email: 'alice@example.com',
};

/**
 * Two-slice happy-path input. JFK→LHR→CDG, 4h layover.
 */
function twoSliceInput(overrides?: { searchId?: string; offerIds?: [string, string] }) {
  const [a, b] = overrides?.offerIds ?? ['off_a1', 'off_b2'];
  return {
    tripId: 'trip_test',
    passenger,
    slices: [
      { sliceIndex: 0, offerId: a },
      { sliceIndex: 1, offerId: b },
    ],
    searchId: overrides?.searchId ?? validSearchId,
  };
}

/**
 * Stamp helper — installs a `recentSplitTicketSearch` blob on
 * Trip.findUnique with the given offerIds + age + searchId.
 */
function stampProvenance(args: { offerIds: string[]; savedAt?: string; searchId?: string }) {
  tripFindUniqueMock.mockImplementation(async () => ({
    metadata: {
      recentSplitTicketSearch: {
        offerIds: args.offerIds,
        savedAt: args.savedAt ?? new Date().toISOString(),
        searchId: args.searchId ?? validSearchId,
      },
    },
  }));
}

/**
 * Wire `createHoldOrderMock` to return per-call segments that match a
 * continuous JFK→LHR→CDG itinerary with the given layover. This keeps
 * the post-phase-1 `checkMinLayoverViolation` backstop satisfied — it
 * walks each hold's `segments` to recompute the gap and would
 * false-positive on a shared default.
 */
function setHoldsContinuous(layoverHours: number = 4) {
  const slice0Arrival = '2026-06-02T06:00:00Z';
  const slice1DepartureMs = Date.parse(slice0Arrival) + layoverHours * 3_600_000;
  const slice1Departure = new Date(slice1DepartureMs).toISOString();
  let attempt = 0;
  createHoldOrderMock.mockImplementation(async (params: unknown) => {
    const p = params as { offerId: string };
    attempt++;
    const isFirst = attempt === 1;
    const segments = isFirst
      ? [
          {
            origin: { iata: 'JFK' },
            destination: { iata: 'LHR' },
            departureAt: '2026-06-01T18:00:00Z',
            arrivalAt: slice0Arrival,
          },
        ]
      : [
          {
            origin: { iata: 'LHR' },
            destination: { iata: 'CDG' },
            departureAt: slice1Departure,
            arrivalAt: '2026-06-02T20:00:00Z',
          },
        ];
    return {
      orderId: `ord_${p.offerId}`,
      bookingReference: `PNR_${p.offerId}`,
      totalAmount: '100.00',
      totalCurrency: 'USD',
      paymentRequiredBy: '2026-06-01T00:00:00Z',
      services: [],
      segments,
      originIata: segments[0].origin.iata,
      destinationIata: segments[segments.length - 1].destination.iata,
      destinationIso2: ['GB'],
      startDate: '2026-06-01',
      endDate: '2026-06-02',
      rawDuffel: null,
    };
  });
}

/**
 * Two consecutive peeks with a configurable layover (hours between
 * slice 0 arrival and slice 1 departure). Defaults to JFK→LHR→CDG.
 */
function setPeeks(args: {
  layoverHours: number;
  origins?: [string, string];
  destinations?: [string, string];
  offerIds?: [string, string];
}) {
  const slice0Arrival = '2026-06-02T06:00:00Z';
  const slice0ArrivalMs = Date.parse(slice0Arrival);
  const slice1DepartureMs = slice0ArrivalMs + args.layoverHours * 3_600_000;
  const slice1Departure = new Date(slice1DepartureMs).toISOString();
  const origins = args.origins ?? ['JFK', 'LHR'];
  const destinations = args.destinations ?? ['LHR', 'CDG'];
  const ids = args.offerIds ?? ['off_a1', 'off_b2'];

  peekOfferSegmentsMock.mockImplementation(async (offerId: string) => {
    const isFirst = offerId === ids[0];
    if (isFirst) {
      return {
        offerId,
        originIata: origins[0],
        destinationIata: destinations[0],
        departureAt: '2026-06-01T18:00:00Z',
        arrivalAt: slice0Arrival,
        segments: [],
      };
    }
    return {
      offerId,
      originIata: origins[1],
      destinationIata: destinations[1],
      departureAt: slice1Departure,
      arrivalAt: '2026-06-02T20:00:00Z',
      segments: [],
    };
  });
}

// ──────────────────────────────────────────────────────────────────
// 1. Tenant gate — disabled
// ──────────────────────────────────────────────────────────────────

describe('book_trip — tenant gate', () => {
  test('rejects when tenant lacks flights.allowSplitTicket', async () => {
    tenantFindUniqueMock.mockImplementation(async () => ({ metadata: { flights: {} } }));

    const out = await bookTripTool.handler(twoSliceInput(), baseCtx);

    expect(out.state).toBe('rejected');
    expect(out.handoffRequired?.reason).toBe('tenant_split_ticket_disabled');
    expect(createHoldOrderMock).not.toHaveBeenCalled();
    expect(peekOfferSegmentsMock).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────────────
// 2-5. Provenance checks
// ──────────────────────────────────────────────────────────────────

describe('book_trip — provenance', () => {
  test('rejects when no recentSplitTicketSearch stamp exists', async () => {
    tripFindUniqueMock.mockImplementation(async () => ({ metadata: {} }));

    const out = await bookTripTool.handler(twoSliceInput(), baseCtx);

    expect(out.state).toBe('rejected');
    expect(out.handoffRequired?.reason).toBe('offer_provenance_missing');
    expect(out.handoffRequired?.suggestedAction).toMatch(/No recent split-ticket search/);
    expect(createHoldOrderMock).not.toHaveBeenCalled();
    expect(peekOfferSegmentsMock).not.toHaveBeenCalled();
  });

  test('rejects when stamp savedAt is older than the 30min TTL', async () => {
    const stale = new Date(Date.now() - 31 * 60_000).toISOString();
    stampProvenance({ offerIds: ['off_a1', 'off_b2'], savedAt: stale });

    const out = await bookTripTool.handler(twoSliceInput(), baseCtx);

    expect(out.state).toBe('rejected');
    expect(out.handoffRequired?.reason).toBe('offer_provenance_missing');
    expect(out.handoffRequired?.suggestedAction).toMatch(/TTL 30min/);
    expect(createHoldOrderMock).not.toHaveBeenCalled();
  });

  test('rejects when caller searchId does not match stamp searchId', async () => {
    stampProvenance({
      offerIds: ['off_a1', 'off_b2'],
      searchId: '22222222-2222-4222-8222-222222222222',
    });

    const out = await bookTripTool.handler(twoSliceInput({ searchId: validSearchId }), baseCtx);

    expect(out.state).toBe('rejected');
    expect(out.handoffRequired?.reason).toBe('offer_provenance_missing');
    expect(out.handoffRequired?.suggestedAction).toMatch(/searchId mismatch/);
    expect(createHoldOrderMock).not.toHaveBeenCalled();
  });

  test('rejects when an offerId is not in the stamp offerIds list', async () => {
    stampProvenance({ offerIds: ['off_a1', 'off_b2'] });

    const out = await bookTripTool.handler(
      twoSliceInput({ offerIds: ['off_a1', 'off_c3'] }),
      baseCtx
    );

    expect(out.state).toBe('rejected');
    expect(out.handoffRequired?.reason).toBe('offer_provenance_missing');
    expect(out.handoffRequired?.suggestedAction).toContain('off_c3');
    expect(createHoldOrderMock).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────────────
// 6-8. Pre-hold layover validation
// ──────────────────────────────────────────────────────────────────

describe('book_trip — pre-hold layover', () => {
  test('rejects when layover is below soft default (3h) with no tenant override', async () => {
    stampProvenance({ offerIds: ['off_a1', 'off_b2'] });
    setPeeks({ layoverHours: 2 });

    const out = await bookTripTool.handler(twoSliceInput(), baseCtx);

    expect(out.state).toBe('rejected');
    expect(out.handoffRequired?.reason).toBe('insufficient_layover');
    expect(createHoldOrderMock).not.toHaveBeenCalled();
  });

  test('tenant override below hard floor clamps to 2h; 2.5h passes pre-hold', async () => {
    stampProvenance({ offerIds: ['off_a1', 'off_b2'] });
    tenantFindUniqueMock.mockImplementation(async () => ({
      metadata: {
        flights: { allowSplitTicket: true, minLayoverHours: 1 /* clamped to 2 */ },
      },
    }));
    setPeeks({ layoverHours: 2.5 });
    setHoldsContinuous(2.5);

    const out = await bookTripTool.handler(twoSliceInput(), baseCtx);

    // 2.5h > clamped 2h floor → not rejected by layover gate.
    // We expect to pass pre-hold and reach all_paid.
    expect(out.state).toBe('all_paid');
    expect(createHoldOrderMock).toHaveBeenCalledTimes(2);
  });

  test('tenant override raises floor; 4h fails when floor is 5h', async () => {
    stampProvenance({ offerIds: ['off_a1', 'off_b2'] });
    tenantFindUniqueMock.mockImplementation(async () => ({
      metadata: {
        flights: { allowSplitTicket: true, minLayoverHours: 5 },
      },
    }));
    setPeeks({ layoverHours: 4 });

    const out = await bookTripTool.handler(twoSliceInput(), baseCtx);

    expect(out.state).toBe('rejected');
    expect(out.handoffRequired?.reason).toBe('insufficient_layover');
    expect(createHoldOrderMock).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────────────
// 9. Route continuity
// ──────────────────────────────────────────────────────────────────

describe('book_trip — route continuity', () => {
  test('rejects when slice N+1 origin ≠ slice N destination', async () => {
    stampProvenance({ offerIds: ['off_a1', 'off_b2'] });
    // Slice 0: JFK → LHR. Slice 1: CDG → MAD. LHR ≠ CDG → mismatch.
    setPeeks({
      layoverHours: 4,
      origins: ['JFK', 'CDG'],
      destinations: ['LHR', 'MAD'],
    });

    const out = await bookTripTool.handler(twoSliceInput(), baseCtx);

    expect(out.state).toBe('rejected');
    expect(out.handoffRequired?.reason).toBe('origin_destination_mismatch');
    expect(createHoldOrderMock).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────────────
// 10-12. Peek retry helper (parallel → retry → sequential → fail)
// ──────────────────────────────────────────────────────────────────

describe('book_trip — peek retry', () => {
  test('parallel fails with 429, retry succeeds → proceeds past pre-hold', async () => {
    stampProvenance({ offerIds: ['off_a1', 'off_b2'] });

    // The retry loop is wrapped in Promise.all — a single throw rejects
    // the entire Promise.all. So one call sequence: try parallel
    // (rejects), wait 250ms, retry parallel (succeeds = 2 more calls).
    let parallelAttempt = 0;
    peekOfferSegmentsMock.mockImplementation(async (offerId: string) => {
      parallelAttempt++;
      if (parallelAttempt === 1) {
        throw new Error('HTTP 429 rate limit exceeded');
      }
      return {
        offerId,
        originIata: 'JFK',
        destinationIata: 'LHR',
        departureAt: '2026-06-01T18:00:00Z',
        arrivalAt: '2026-06-02T06:00:00Z',
        segments: [],
      };
    });
    setPeeks({ layoverHours: 4 }); // overwrites the impl above — need different approach

    // Re-install: 1st call throws 429, all subsequent succeed with
    // a valid JFK→LHR→CDG continuity.
    let callCount = 0;
    peekOfferSegmentsMock.mockImplementation(async (offerId: string) => {
      callCount++;
      if (callCount === 1) {
        throw new Error('HTTP 429 rate limit exceeded');
      }
      // After the 429, the orchestrator retries Promise.all so both
      // ids resolve on the second pass. Map ids to slice peeks by
      // input order (book_trip preserves it via .map).
      if (offerId === 'off_a1') {
        return {
          offerId,
          originIata: 'JFK',
          destinationIata: 'LHR',
          departureAt: '2026-06-01T18:00:00Z',
          arrivalAt: '2026-06-02T06:00:00Z',
          segments: [],
        };
      }
      return {
        offerId,
        originIata: 'LHR',
        destinationIata: 'CDG',
        departureAt: '2026-06-02T10:00:00Z',
        arrivalAt: '2026-06-02T13:00:00Z',
        segments: [],
      };
    });
    setHoldsContinuous(4);

    const out = await bookTripTool.handler(twoSliceInput(), baseCtx);

    // Retry succeeded and the orchestrator continued through holds + pay.
    expect(out.state).toBe('all_paid');
    expect(createHoldOrderMock).toHaveBeenCalledTimes(2);
  });

  test('parallel fails twice retryably, sequential fallback succeeds', async () => {
    stampProvenance({ offerIds: ['off_a1', 'off_b2'] });

    // First parallel pair: both throw. Second parallel pair: both
    // throw. Sequential pass (4 more calls? no — 2 sequential calls):
    // both succeed.
    let callCount = 0;
    peekOfferSegmentsMock.mockImplementation(async (offerId: string) => {
      callCount++;
      // First parallel: calls 1+2 throw. Second parallel: 3+4 throw.
      // Sequential: calls 5+6 succeed.
      if (callCount <= 4) {
        throw new Error('HTTP 503 service unavailable');
      }
      if (offerId === 'off_a1') {
        return {
          offerId,
          originIata: 'JFK',
          destinationIata: 'LHR',
          departureAt: '2026-06-01T18:00:00Z',
          arrivalAt: '2026-06-02T06:00:00Z',
          segments: [],
        };
      }
      return {
        offerId,
        originIata: 'LHR',
        destinationIata: 'CDG',
        departureAt: '2026-06-02T10:00:00Z',
        arrivalAt: '2026-06-02T13:00:00Z',
        segments: [],
      };
    });
    setHoldsContinuous(4);

    const out = await bookTripTool.handler(twoSliceInput(), baseCtx);

    expect(out.state).toBe('all_paid');
    // Confirms sequential fallback was reached (calls 5 + 6 are the
    // successful sequential pass).
    expect(callCount).toBeGreaterThanOrEqual(5);
  });

  test('non-retryable error short-circuits (no retry, no sequential fallback)', async () => {
    stampProvenance({ offerIds: ['off_a1', 'off_b2'] });

    let callCount = 0;
    peekOfferSegmentsMock.mockImplementation(async () => {
      callCount++;
      throw new Error('HTTP 400 bad request');
    });

    const out = await bookTripTool.handler(twoSliceInput(), baseCtx);

    expect(out.state).toBe('rejected');
    expect(out.handoffRequired?.reason).toBe('offer_peek_failed');
    // Only the first parallel attempt happened — 2 ids × 1 attempt = 2 calls.
    // (Promise.all kicks off both before the rejection propagates.)
    expect(callCount).toBeLessThanOrEqual(2);
    expect(createHoldOrderMock).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────────────
// 13. Phase-1 rollback
// ──────────────────────────────────────────────────────────────────

describe('book_trip — phase-1 rollback', () => {
  test('hold failure on slice 1 cancels slice 0 hold; state=hold_failed', async () => {
    stampProvenance({ offerIds: ['off_a1', 'off_b2'] });
    setPeeks({ layoverHours: 4 });

    let holdAttempt = 0;
    createHoldOrderMock.mockImplementation(async (params: unknown) => {
      holdAttempt++;
      const p = params as { offerId: string };
      if (holdAttempt === 1) {
        return {
          orderId: 'ord_slice0',
          bookingReference: 'PNR_A',
          totalAmount: '100.00',
          totalCurrency: 'USD',
          paymentRequiredBy: '2026-06-01T00:00:00Z',
          services: [],
          segments: [
            {
              origin: { iata: 'JFK' },
              destination: { iata: 'LHR' },
              departureAt: '2026-06-01T18:00:00Z',
              arrivalAt: '2026-06-02T06:00:00Z',
            },
          ],
          originIata: 'JFK',
          destinationIata: 'LHR',
          destinationIso2: ['GB'],
          startDate: '2026-06-01',
          endDate: '2026-06-02',
          rawDuffel: null,
        };
      }
      throw new Error(`Duffel hold failed for ${p.offerId}`);
    });

    const out = await bookTripTool.handler(twoSliceInput(), baseCtx);

    expect(out.state).toBe('hold_failed');
    expect(out.handoffRequired?.reason).toBe('hold_failed_slice_1');
    // Slice 0 was held then rolled back.
    expect(createOrderCancellationMock).toHaveBeenCalledTimes(1);
    expect(createOrderCancellationMock.mock.calls[0]?.[0]).toBe('ord_slice0');
    expect(confirmOrderCancellationMock).toHaveBeenCalledTimes(1);
    // Slice 0 marked rolled_back, slice 1 marked failed.
    const slice0 = out.slices.find(s => s.sliceIndex === 0);
    const slice1 = out.slices.find(s => s.sliceIndex === 1);
    expect(slice0?.state).toBe('rolled_back');
    expect(slice1?.state).toBe('failed');
    // No payment ever attempted.
    expect(payFromBalanceMock).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────────────
// 14. Phase-2 partial_paid persistence + unpaid-hold cleanup
// ──────────────────────────────────────────────────────────────────

describe('book_trip — phase-2 partial paid', () => {
  test('3-slice trip: slice 1 pay fails after slice 0 paid; slice 2 hold cancelled', async () => {
    stampProvenance({ offerIds: ['off_a1', 'off_b2', 'off_c3'] });

    // Three peeks — JFK→LHR→CDG→MAD, each 4h layover.
    let peekCall = 0;
    peekOfferSegmentsMock.mockImplementation(async (offerId: string) => {
      peekCall++;
      const config = [
        {
          originIata: 'JFK',
          destinationIata: 'LHR',
          departureAt: '2026-06-01T18:00:00Z',
          arrivalAt: '2026-06-02T06:00:00Z',
        },
        {
          originIata: 'LHR',
          destinationIata: 'CDG',
          departureAt: '2026-06-02T10:00:00Z',
          arrivalAt: '2026-06-02T13:00:00Z',
        },
        {
          originIata: 'CDG',
          destinationIata: 'MAD',
          departureAt: '2026-06-02T17:00:00Z',
          arrivalAt: '2026-06-02T19:00:00Z',
        },
      ];
      const idMap: Record<string, number> = { off_a1: 0, off_b2: 1, off_c3: 2 };
      const c = config[idMap[offerId] ?? 0];
      return { offerId, ...c, segments: [] };
    });

    // All 3 holds succeed with per-slice continuous segments so the
    // post-phase-1 layover backstop doesn't false-positive.
    const sliceHoldSegments: Array<{
      origin: { iata: string };
      destination: { iata: string };
      departureAt: string;
      arrivalAt: string;
    }> = [
      {
        origin: { iata: 'JFK' },
        destination: { iata: 'LHR' },
        departureAt: '2026-06-01T18:00:00Z',
        arrivalAt: '2026-06-02T06:00:00Z',
      },
      {
        origin: { iata: 'LHR' },
        destination: { iata: 'CDG' },
        departureAt: '2026-06-02T10:00:00Z',
        arrivalAt: '2026-06-02T13:00:00Z',
      },
      {
        origin: { iata: 'CDG' },
        destination: { iata: 'MAD' },
        departureAt: '2026-06-02T17:00:00Z',
        arrivalAt: '2026-06-02T19:00:00Z',
      },
    ];
    let holdAttempt = 0;
    createHoldOrderMock.mockImplementation(async (params: unknown) => {
      const p = params as { offerId: string };
      const segs = [sliceHoldSegments[holdAttempt]];
      holdAttempt++;
      return {
        orderId: `ord_${p.offerId}`,
        bookingReference: `PNR_${p.offerId}`,
        totalAmount: '100.00',
        totalCurrency: 'USD',
        paymentRequiredBy: '2026-06-01T00:00:00Z',
        services: [],
        segments: segs,
        originIata: segs[0].origin.iata,
        destinationIata: segs[0].destination.iata,
        destinationIso2: ['EU'],
        startDate: '2026-06-01',
        endDate: '2026-06-02',
        rawDuffel: null,
      };
    });

    // Slice 0 pay succeeds, slice 1 pay throws.
    let payAttempt = 0;
    payFromBalanceMock.mockImplementation(async () => {
      payAttempt++;
      if (payAttempt === 2) throw new Error('insufficient gateway balance');
      return {} as never;
    });

    const out = await bookTripTool.handler(
      {
        tripId: 'trip_3slice',
        passenger,
        slices: [
          { sliceIndex: 0, offerId: 'off_a1' },
          { sliceIndex: 1, offerId: 'off_b2' },
          { sliceIndex: 2, offerId: 'off_c3' },
        ],
        searchId: validSearchId,
      },
      baseCtx
    );

    expect(out.state).toBe('partial_paid');
    expect(out.handoffRequired?.reason).toContain('pay_failed_slice_1_after_1_paid');

    // Slice 0 booking row was created (paid).
    expect(bookingCreateMock).toHaveBeenCalledTimes(1);

    // Slice 2 (held but never paid because slice 1 failed) was cancelled.
    expect(createOrderCancellationMock).toHaveBeenCalledTimes(1);
    expect(createOrderCancellationMock.mock.calls[0]?.[0]).toBe('ord_off_c3');

    // Durable state persisted on Trip.metadata.splitTicketState.
    const updateCalls = tripUpdateMock.mock.calls;
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);
    const lastUpdateArg = updateCalls[updateCalls.length - 1]?.[0] as {
      data: { metadata: { splitTicketState: { state: string; slices: unknown[] } } };
    };
    expect(lastUpdateArg.data.metadata.splitTicketState.state).toBe('partial_paid');
    expect(lastUpdateArg.data.metadata.splitTicketState.slices).toHaveLength(3);
  });
});

// ──────────────────────────────────────────────────────────────────
// 15. All-paid happy path
// ──────────────────────────────────────────────────────────────────

describe('book_trip — all_paid happy path', () => {
  test('2 slices: every step succeeds → state=all_paid, bookings + meta persisted', async () => {
    stampProvenance({ offerIds: ['off_a1', 'off_b2'] });

    // Peeks: JFK→LHR→CDG, 4h layover, route continuous.
    peekOfferSegmentsMock.mockImplementation(async (offerId: string) => {
      if (offerId === 'off_a1') {
        return {
          offerId,
          originIata: 'JFK',
          destinationIata: 'LHR',
          departureAt: '2026-06-01T18:00:00Z',
          arrivalAt: '2026-06-02T06:00:00Z',
          segments: [],
        };
      }
      return {
        offerId,
        originIata: 'LHR',
        destinationIata: 'CDG',
        departureAt: '2026-06-02T10:00:00Z',
        arrivalAt: '2026-06-02T13:00:00Z',
        segments: [],
      };
    });

    // Hold mock — per-slice continuous segments so the post-phase-1
    // `checkMinLayoverViolation` backstop doesn't false-positive on
    // a shared default.
    setHoldsContinuous(4);

    const out = await bookTripTool.handler(twoSliceInput(), baseCtx);

    expect(out.state).toBe('all_paid');
    expect(out.handoffRequired).toBeUndefined();

    // 2 holds, 2 pays, 2 bookings.
    expect(createHoldOrderMock).toHaveBeenCalledTimes(2);
    expect(payFromBalanceMock).toHaveBeenCalledTimes(2);
    expect(bookingCreateMock).toHaveBeenCalledTimes(2);

    // Idempotency keys are deterministic per-slice.
    const pay0Args = payFromBalanceMock.mock.calls[0] as [string, { idempotencyKey: string }];
    const pay1Args = payFromBalanceMock.mock.calls[1] as [string, { idempotencyKey: string }];
    expect(pay0Args[1].idempotencyKey).toBe('book-trip-trip_test-slice-0-pay');
    expect(pay1Args[1].idempotencyKey).toBe('book-trip-trip_test-slice-1-pay');

    // No rollback path executed.
    expect(createOrderCancellationMock).not.toHaveBeenCalled();
    expect(confirmOrderCancellationMock).not.toHaveBeenCalled();

    // Trip.metadata.splitTicketState persisted as all_paid.
    const updateCalls = tripUpdateMock.mock.calls;
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);
    const lastUpdateArg = updateCalls[updateCalls.length - 1]?.[0] as {
      data: { metadata: { splitTicketState: { state: string } } };
    };
    expect(lastUpdateArg.data.metadata.splitTicketState.state).toBe('all_paid');

    // Each slice reports state=paid + a bookingId.
    for (const s of out.slices) {
      expect(s.state).toBe('paid');
      expect(s.bookingId).toBe('bkg_test_1');
      expect(s.duffelOrderId).toStartWith('ord_');
    }
  });
});
