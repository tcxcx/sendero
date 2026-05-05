/**
 * get_trip_brief unit tests.
 *
 * Covers the aggregator behavior + section-filter contract + alert
 * derivation. Stubs deps so we never touch Prisma. Anti-circular: the
 * assertions verify behavior the user depends on (alerts fire on the
 * right conditions, summaries pull the right fields out of segments
 * JSON, share URL is null vs string based on secret presence) — not
 * just that the function returns its inputs.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { runGetTripBrief, type GetTripBriefDeps, type GetTripBriefInput } from './get-trip-brief';

const realSecret = process.env.INVOICE_SIGNING_SECRET;
const realBaseUrl = process.env.NEXT_PUBLIC_APP_URL;

beforeEach(() => {
  process.env.INVOICE_SIGNING_SECRET = 'test-trip-brief-secret-please-rotate';
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.sendero.travel';
});
afterEach(() => {
  if (realSecret === undefined) delete process.env.INVOICE_SIGNING_SECRET;
  else process.env.INVOICE_SIGNING_SECRET = realSecret;
  if (realBaseUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = realBaseUrl;
});

// ── Fixtures ──────────────────────────────────────────────────────────

interface FakeBooking {
  id: string;
  tenantId: string;
  tripId: string;
  kind: string;
  status: string;
  pnr: string | null;
  totalUsd: { toString(): string };
  segments: unknown[] | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

interface FakeEsim {
  id: string;
  tenantId: string;
  tripId: string;
  status: string;
  destinationCountries: unknown;
  dataMb: number;
  validityDays: number;
  expiresAt: Date | null;
  createdAt: Date;
}

interface FakeTrip {
  id: string;
  tenantId: string;
  status: string;
  kind: 'one_way' | 'round_trip' | 'open_journey';
  intent: Record<string, unknown>;
}

function tripFixture(over: Partial<FakeTrip> = {}): FakeTrip {
  return {
    id: 'trp_1',
    tenantId: 'org_1',
    status: 'in_progress',
    kind: 'round_trip',
    intent: {
      origin: 'EZE',
      destination: 'JFK',
      destinationIso2: ['us'],
      startDate: '2026-06-01',
      endDate: '2026-06-08',
      name: 'NYC week',
    },
    ...over,
  };
}

function flightBooking(over: Partial<FakeBooking> = {}): FakeBooking {
  return {
    id: 'bkg_flight_1',
    tenantId: 'org_1',
    tripId: 'trp_1',
    kind: 'flight',
    status: 'ticketed',
    pnr: 'XYZ123',
    totalUsd: { toString: () => '850.00' },
    segments: [
      {
        origin: { iata: 'EZE' },
        destination: { iata: 'JFK' },
        departing_at: '2026-06-01T22:00:00Z',
        arriving_at: '2026-06-02T08:30:00Z',
      },
    ],
    metadata: null,
    createdAt: new Date('2026-05-01T00:00:00Z'),
    ...over,
  };
}

function stayBooking(over: Partial<FakeBooking> = {}): FakeBooking {
  return {
    id: 'bkg_stay_1',
    tenantId: 'org_1',
    tripId: 'trp_1',
    kind: 'hotel',
    status: 'confirmed',
    pnr: null,
    totalUsd: { toString: () => '1200.00' },
    segments: null,
    metadata: {
      property: { name: 'The Mercer Hotel' },
      city: 'New York',
      checkInDate: '2026-06-02',
      checkOutDate: '2026-06-08',
      nights: 6,
    },
    createdAt: new Date('2026-05-01T00:00:00Z'),
    ...over,
  };
}

function esimRow(over: Partial<FakeEsim> = {}): FakeEsim {
  return {
    id: 'esim_1',
    tenantId: 'org_1',
    tripId: 'trp_1',
    status: 'active',
    destinationCountries: ['US'],
    dataMb: 5120,
    validityDays: 30,
    expiresAt: new Date('2026-06-30T00:00:00Z'),
    createdAt: new Date('2026-05-15T00:00:00Z'),
    ...over,
  };
}

function makeDeps(args: {
  trip?: FakeTrip | null;
  bookings?: FakeBooking[];
  esims?: FakeEsim[];
  shareUrl?: string | null;
  installUrl?: string | null;
}): GetTripBriefDeps {
  return {
    async loadTrip() {
      return args.trip as never;
    },
    async loadBookings() {
      return (args.bookings ?? []) as never;
    },
    async loadEsims() {
      return (args.esims ?? []) as never;
    },
    async buildShareUrl() {
      // Explicit `shareUrl: null` MUST pass through (covers
      // "secret not configured" branch); only fall back to default
      // when the key is unset entirely.
      return 'shareUrl' in args
        ? (args.shareUrl ?? null)
        : 'https://app.sendero.travel/trip/SIGNED';
    },
    async buildEsimInstallUrl() {
      return 'installUrl' in args
        ? (args.installUrl ?? null)
        : 'https://app.sendero.travel/install/esim/SIGNED';
    },
  };
}

const baseInput: GetTripBriefInput = { tripId: 'trp_1' };

// ── Trip lookup ──────────────────────────────────────────────────────

describe('get_trip_brief — trip lookup', () => {
  test('not_found when trip missing', async () => {
    const out = await runGetTripBrief(baseInput, makeDeps({ trip: null }));
    expect(out.status).toBe('not_found');
  });

  test('returns ok with trip header even when nothing else booked', async () => {
    const out = await runGetTripBrief(baseInput, makeDeps({ trip: tripFixture() }));
    expect(out.status).toBe('ok');
    if (out.status !== 'ok') return;
    expect(out.trip.tripId).toBe('trp_1');
    expect(out.trip.destination).toBe('JFK');
    expect(out.trip.destinationCountriesIso2).toEqual(['us']);
    expect(out.flights).toEqual([]);
    expect(out.stays).toEqual([]);
    expect(out.esims).toEqual([]);
  });
});

// ── Section composition ──────────────────────────────────────────────

describe('get_trip_brief — sections', () => {
  test('all sections returned by default (no filter)', async () => {
    const out = await runGetTripBrief(
      baseInput,
      makeDeps({
        trip: tripFixture(),
        bookings: [flightBooking(), stayBooking()],
        esims: [esimRow()],
      })
    );
    if (out.status !== 'ok') throw new Error('expected ok');
    expect(out.flights).toHaveLength(1);
    expect(out.stays).toHaveLength(1);
    expect(out.esims).toHaveLength(1);
    expect(out.sectionsIncluded.sort()).toEqual(['esim', 'flights', 'stays']);
  });

  test('sections=["flights"] — esim + stays NOT loaded (deps not invoked)', async () => {
    let bookingsCalls = 0;
    let esimsCalls = 0;
    const deps: GetTripBriefDeps = {
      async loadTrip() {
        return tripFixture() as never;
      },
      async loadBookings() {
        bookingsCalls += 1;
        return [flightBooking() as never];
      },
      async loadEsims() {
        esimsCalls += 1;
        return [];
      },
      async buildShareUrl() {
        return null;
      },
      async buildEsimInstallUrl() {
        return null;
      },
    };
    const out = await runGetTripBrief({ tripId: 'trp_1', sections: ['flights'] }, deps);
    if (out.status !== 'ok') throw new Error('expected ok');
    expect(out.flights).toHaveLength(1);
    expect(out.stays).toHaveLength(0);
    expect(out.esims).toHaveLength(0);
    expect(bookingsCalls).toBe(1);
    // esim section skipped → loadEsims should not have been called
    expect(esimsCalls).toBe(0);
  });

  test('sections=["all"] is equivalent to omitting filter', async () => {
    const deps = makeDeps({
      trip: tripFixture(),
      bookings: [flightBooking(), stayBooking()],
      esims: [esimRow()],
    });
    const a = await runGetTripBrief({ tripId: 'trp_1' }, deps);
    const b = await runGetTripBrief({ tripId: 'trp_1', sections: ['all'] }, deps);
    if (a.status !== 'ok' || b.status !== 'ok') throw new Error('expected ok');
    expect(a.flights.length).toBe(b.flights.length);
    expect(a.stays.length).toBe(b.stays.length);
    expect(a.esims.length).toBe(b.esims.length);
  });
});

// ── Summarization ────────────────────────────────────────────────────

describe('get_trip_brief — flight summarization', () => {
  test('extracts origin, destination, times from segments[]', async () => {
    const out = await runGetTripBrief(
      baseInput,
      makeDeps({
        trip: tripFixture(),
        bookings: [
          flightBooking({
            segments: [
              {
                origin: { iata: 'EZE' },
                destination: { iata: 'GRU' },
                departing_at: '2026-06-01T22:00:00Z',
                arriving_at: '2026-06-02T01:00:00Z',
              },
              {
                origin: { iata: 'GRU' },
                destination: { iata: 'JFK' },
                departing_at: '2026-06-02T03:00:00Z',
                arriving_at: '2026-06-02T11:30:00Z',
              },
            ],
          }),
        ],
      })
    );
    if (out.status !== 'ok') throw new Error('expected ok');
    const f = out.flights[0];
    // First segment origin, last segment destination
    expect(f.origin).toBe('EZE');
    expect(f.destination).toBe('JFK');
    expect(f.segmentCount).toBe(2);
    expect(f.departureAt).toBe('2026-06-01T22:00:00Z');
    expect(f.arrivalAt).toBe('2026-06-02T11:30:00Z');
  });

  test('handles empty segments[] gracefully (no crash, null fields)', async () => {
    const out = await runGetTripBrief(
      baseInput,
      makeDeps({
        trip: tripFixture(),
        bookings: [flightBooking({ segments: [] })],
      })
    );
    if (out.status !== 'ok') throw new Error('expected ok');
    const f = out.flights[0];
    expect(f.origin).toBeNull();
    expect(f.destination).toBeNull();
    expect(f.segmentCount).toBe(0);
  });

  test('reads pnr + totalUsd through to summary', async () => {
    const out = await runGetTripBrief(
      baseInput,
      makeDeps({ trip: tripFixture(), bookings: [flightBooking({ pnr: 'ABC999' })] })
    );
    if (out.status !== 'ok') throw new Error('expected ok');
    expect(out.flights[0].pnr).toBe('ABC999');
    expect(out.flights[0].totalUsd).toBe('850.00');
  });
});

describe('get_trip_brief — stay summarization', () => {
  test('extracts property name + check-in/out + nights from metadata', async () => {
    const out = await runGetTripBrief(
      baseInput,
      makeDeps({ trip: tripFixture(), bookings: [stayBooking()] })
    );
    if (out.status !== 'ok') throw new Error('expected ok');
    const s = out.stays[0];
    expect(s.property).toBe('The Mercer Hotel');
    expect(s.city).toBe('New York');
    expect(s.checkInDate).toBe('2026-06-02');
    expect(s.checkOutDate).toBe('2026-06-08');
    expect(s.nights).toBe(6);
  });

  test('falls back gracefully when metadata is empty', async () => {
    const out = await runGetTripBrief(
      baseInput,
      makeDeps({
        trip: tripFixture(),
        bookings: [stayBooking({ metadata: null })],
      })
    );
    if (out.status !== 'ok') throw new Error('expected ok');
    const s = out.stays[0];
    expect(s.property).toBeNull();
    expect(s.nights).toBeNull();
  });
});

describe('get_trip_brief — esim summarization', () => {
  test('countries[] read from JSON, install URL populated', async () => {
    const out = await runGetTripBrief(
      baseInput,
      makeDeps({
        trip: tripFixture(),
        esims: [esimRow({ destinationCountries: ['US', 'CA'] })],
      })
    );
    if (out.status !== 'ok') throw new Error('expected ok');
    const e = out.esims[0];
    expect(e.countries).toEqual(['US', 'CA']);
    expect(e.installUrl).toContain('/install/esim/');
  });

  test('non-array destinationCountries → empty array (no crash)', async () => {
    const out = await runGetTripBrief(
      baseInput,
      makeDeps({
        trip: tripFixture(),
        esims: [esimRow({ destinationCountries: { malformed: true } })],
      })
    );
    if (out.status !== 'ok') throw new Error('expected ok');
    expect(out.esims[0].countries).toEqual([]);
  });
});

// ── Alerts ───────────────────────────────────────────────────────────

describe('get_trip_brief — alerts', () => {
  test('no_bookings alert fires on empty in-progress trip', async () => {
    const out = await runGetTripBrief(
      baseInput,
      makeDeps({ trip: tripFixture({ status: 'in_progress' }) })
    );
    if (out.status !== 'ok') throw new Error('expected ok');
    expect(out.alerts.some(a => a.kind === 'no_bookings')).toBe(true);
  });

  test('no_bookings does NOT fire when trip is completed', async () => {
    const out = await runGetTripBrief(
      baseInput,
      makeDeps({ trip: tripFixture({ status: 'completed' }) })
    );
    if (out.status !== 'ok') throw new Error('expected ok');
    expect(out.alerts.some(a => a.kind === 'no_bookings')).toBe(false);
  });

  test('trip_canceled alert always fires when trip status is canceled', async () => {
    const out = await runGetTripBrief(
      baseInput,
      makeDeps({
        trip: tripFixture({ status: 'canceled' }),
        bookings: [flightBooking()], // even with bookings, canceled fires
      })
    );
    if (out.status !== 'ok') throw new Error('expected ok');
    const cancel = out.alerts.find(a => a.kind === 'trip_canceled');
    expect(cancel?.severity).toBe('critical');
  });

  test('flight_canceled alert per canceled flight', async () => {
    const out = await runGetTripBrief(
      baseInput,
      makeDeps({
        trip: tripFixture(),
        bookings: [flightBooking({ status: 'canceled', pnr: 'XYZ123' })],
      })
    );
    if (out.status !== 'ok') throw new Error('expected ok');
    const fc = out.alerts.find(a => a.kind === 'flight_canceled');
    expect(fc?.message).toContain('XYZ123');
  });

  test('esim_expiring alert when expiry <3 days away', async () => {
    const soon = new Date(Date.now() + 24 * 60 * 60 * 1000); // +1 day
    const out = await runGetTripBrief(
      baseInput,
      makeDeps({
        trip: tripFixture(),
        esims: [esimRow({ expiresAt: soon })],
      })
    );
    if (out.status !== 'ok') throw new Error('expected ok');
    expect(out.alerts.some(a => a.kind === 'esim_expiring')).toBe(true);
  });

  test('esim_expiring does NOT fire when expiry >3 days away', async () => {
    const far = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // +30 days
    const out = await runGetTripBrief(
      baseInput,
      makeDeps({
        trip: tripFixture(),
        esims: [esimRow({ expiresAt: far })],
      })
    );
    if (out.status !== 'ok') throw new Error('expected ok');
    expect(out.alerts.some(a => a.kind === 'esim_expiring')).toBe(false);
  });

  test('esim_expiring does NOT fire when esim already expired (past date)', async () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const out = await runGetTripBrief(
      baseInput,
      makeDeps({
        trip: tripFixture(),
        esims: [esimRow({ expiresAt: past })],
      })
    );
    if (out.status !== 'ok') throw new Error('expected ok');
    // expired is its own state — esim_expiring is for soon-to-expire only
    expect(out.alerts.some(a => a.kind === 'esim_expiring')).toBe(false);
  });
});

// ── Share URL ────────────────────────────────────────────────────────

describe('get_trip_brief — shareUrl', () => {
  test('null when builder returns null (no signing secret)', async () => {
    const out = await runGetTripBrief(baseInput, makeDeps({ trip: tripFixture(), shareUrl: null }));
    if (out.status !== 'ok') throw new Error('expected ok');
    expect(out.shareUrl).toBeNull();
  });

  test('signed URL when builder returns one', async () => {
    const out = await runGetTripBrief(
      baseInput,
      makeDeps({
        trip: tripFixture(),
        shareUrl: 'https://app.sendero.travel/trip/abc.def',
      })
    );
    if (out.status !== 'ok') throw new Error('expected ok');
    expect(out.shareUrl).toBe('https://app.sendero.travel/trip/abc.def');
  });
});

// ── Schema ───────────────────────────────────────────────────────────

describe('get_trip_brief — input schema', () => {
  test('rejects empty tripId', async () => {
    // This is the schema check that runs before the handler — we re-run
    // it directly here so the contract surfaces explicitly.
    const { getTripBriefTool } = await import('./get-trip-brief');
    const r = getTripBriefTool.inputSchema.safeParse({ tripId: '' });
    expect(r.success).toBe(false);
  });

  test('rejects unknown section value', async () => {
    const { getTripBriefTool } = await import('./get-trip-brief');
    const r = getTripBriefTool.inputSchema.safeParse({
      tripId: 'trp_1',
      sections: ['lounge'],
    });
    expect(r.success).toBe(false);
  });
});
