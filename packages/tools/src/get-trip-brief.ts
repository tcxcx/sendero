/**
 * get_trip_brief — single-call canonical view of everything Sendero
 * knows about a trip. Aggregates Trip + Booking + Esim into one
 * payload the agent renders as a single sectioned card across every
 * channel (operator, Slack, WhatsApp, web).
 *
 * What this replaces: 3-5 piecemeal tool calls per turn the agent
 * was making to recap a trip ("get_active_trip + list_flight_ancillaries
 * + esim status + ..."). One round trip, one render.
 *
 * Pure read aggregator — never mutates. No new schema. The shareUrl
 * is signed by `INVOICE_SIGNING_SECRET` via
 * `apps/app/lib/trip-brief-token.ts`; lives at `/trip/[token]`,
 * public, read-only, OG-image friendly.
 *
 * Sections:
 *   - flights:      Booking[kind='flight']
 *   - stays:        Booking[kind='hotel']
 *   - esims:        Esim rows for the trip
 *   - alerts:       derived (passport expiring, esim near zero, …)
 *   - shareUrl:     signed `/trip/<token>` link
 *
 * Out of scope (returned as undefined when not yet wired):
 *   - weather:      requires destination coords; agent calls
 *                   `trip_weather_brief` separately when worth surfacing
 *   - requirements: requires sherpa° creds; surfaced when available
 *   - insurance:    parked until Faye creds land
 *
 * Always returns `status: 'ok'` when the trip exists, even if all
 * sections are empty — empty is signal ("nothing booked yet"), not an
 * error.
 */

import { z } from 'zod';

import { prisma, type Booking, type BookingKind, type Esim, type Trip } from '@sendero/database';

import { buildTripBriefShareUrl } from './lib/trip-brief-token';
import type { ToolDef } from './types';

const SECTION_VALUES = ['flights', 'stays', 'esim', 'weather', 'requirements', 'all'] as const;
export type TripBriefSection = (typeof SECTION_VALUES)[number];

const inputSchema = z.object({
  tripId: z.string().min(1),
  /** When omitted, returns all sections. */
  sections: z.array(z.enum(SECTION_VALUES)).optional(),
});

export type GetTripBriefInput = z.infer<typeof inputSchema>;

export interface FlightBookingSummary {
  bookingId: string;
  pnr: string | null;
  status: string;
  origin: string | null;
  destination: string | null;
  departureAt: string | null;
  arrivalAt: string | null;
  totalUsd: string;
  /** Number of segments (1 for direct, 2+ for connections). */
  segmentCount: number;
}

export interface StayBookingSummary {
  bookingId: string;
  status: string;
  property: string | null;
  city: string | null;
  checkInDate: string | null;
  checkOutDate: string | null;
  nights: number | null;
  totalUsd: string;
}

export interface EsimSummary {
  esimId: string;
  status: string;
  countries: string[];
  dataMb: number;
  validityDays: number;
  expiresAt: string | null;
  /** Activation install URL when present (signed `/install/esim/<token>`). */
  installUrl: string | null;
}

export interface TripBriefAlert {
  kind:
    | 'esim_expiring'
    | 'esim_near_zero'
    | 'flight_change'
    | 'flight_canceled'
    | 'no_bookings'
    | 'trip_canceled';
  severity: 'info' | 'warn' | 'critical';
  message: string;
}

export interface TripBriefHeader {
  tripId: string;
  name: string | null;
  status: string;
  kind: string;
  origin: string | null;
  destination: string | null;
  destinationCountriesIso2: string[];
  startDate: string | null;
  endDate: string | null;
}

export type GetTripBriefResult =
  | {
      status: 'ok';
      trip: TripBriefHeader;
      flights: FlightBookingSummary[];
      stays: StayBookingSummary[];
      esims: EsimSummary[];
      alerts: TripBriefAlert[];
      shareUrl: string | null;
      sectionsIncluded: TripBriefSection[];
    }
  | { status: 'not_found'; tripId: string }
  | { status: 'forbidden'; reason: string };

// ── Deps (DI for tests) ──────────────────────────────────────────────

export interface GetTripBriefDeps {
  loadTrip(tripId: string): Promise<Trip | null>;
  loadBookings(tripId: string): Promise<Booking[]>;
  loadEsims(tripId: string): Promise<Esim[]>;
  buildShareUrl(args: { tripId: string; tenantId: string }): Promise<string | null>;
  /** Optional: build install URL for a given esimId (signed). Returns null when secret unset. */
  buildEsimInstallUrl(esimId: string): Promise<string | null>;
}

// ── Defaults (real DB) ───────────────────────────────────────────────

export const dbDependencies: GetTripBriefDeps = {
  async loadTrip(tripId: string) {
    return prisma.trip.findUnique({ where: { id: tripId } });
  },
  async loadBookings(tripId: string) {
    return prisma.booking.findMany({
      where: { tripId },
      orderBy: { createdAt: 'asc' },
    });
  },
  async loadEsims(tripId: string) {
    return prisma.esim.findMany({
      where: { tripId },
      orderBy: { createdAt: 'asc' },
    });
  },
  async buildShareUrl(args) {
    return buildTripBriefShareUrl(args);
  },
  async buildEsimInstallUrl(esimId: string) {
    try {
      const { signQrToken } = (await import('@sendero/esim')) as typeof import('@sendero/esim');
      const secret = process.env.INVOICE_SIGNING_SECRET;
      if (!secret) return null;
      const token = signQrToken(esimId, secret);
      const baseUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '');
      return baseUrl
        ? `${baseUrl}/install/esim/${encodeURIComponent(token)}`
        : `/install/esim/${encodeURIComponent(token)}`;
    } catch {
      return null;
    }
  },
};

// ── Section helpers ──────────────────────────────────────────────────

interface FlightSegment {
  origin?: { iata?: string; iata_code?: string } | string | null;
  destination?: { iata?: string; iata_code?: string } | string | null;
  departing_at?: string | null;
  arriving_at?: string | null;
  marketing_carrier_flight_number?: string | null;
}

function readSegments(b: Booking): FlightSegment[] {
  const raw = b.segments;
  if (!Array.isArray(raw)) return [];
  return raw as FlightSegment[];
}

function readIata(value: FlightSegment['origin']): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  return value.iata ?? value.iata_code ?? null;
}

function summarizeFlight(b: Booking): FlightBookingSummary {
  const segments = readSegments(b);
  const first = segments[0];
  const last = segments[segments.length - 1];
  return {
    bookingId: b.id,
    pnr: b.pnr ?? null,
    status: b.status,
    origin: first ? readIata(first.origin) : null,
    destination: last ? readIata(last.destination) : null,
    departureAt: first?.departing_at ?? null,
    arrivalAt: last?.arriving_at ?? null,
    totalUsd: b.totalUsd.toString(),
    segmentCount: segments.length,
  };
}

interface StayMetadata {
  property?: { name?: string | null } | null;
  hotel?: { name?: string | null } | null;
  city?: string | null;
  checkInDate?: string | null;
  checkOutDate?: string | null;
  nights?: number | null;
}

function summarizeStay(b: Booking): StayBookingSummary {
  const meta = (b.metadata ?? {}) as StayMetadata;
  const property = meta.property?.name ?? meta.hotel?.name ?? null;
  return {
    bookingId: b.id,
    status: b.status,
    property,
    city: meta.city ?? null,
    checkInDate: meta.checkInDate ?? null,
    checkOutDate: meta.checkOutDate ?? null,
    nights: meta.nights ?? null,
    totalUsd: b.totalUsd.toString(),
  };
}

async function summarizeEsim(
  e: Esim,
  buildInstallUrl: GetTripBriefDeps['buildEsimInstallUrl']
): Promise<EsimSummary> {
  const countries = Array.isArray(e.destinationCountries)
    ? (e.destinationCountries as unknown[]).filter((c): c is string => typeof c === 'string')
    : [];
  return {
    esimId: e.id,
    status: e.status,
    countries,
    dataMb: e.dataMb,
    validityDays: e.validityDays,
    expiresAt: e.expiresAt ? e.expiresAt.toISOString() : null,
    installUrl: await buildInstallUrl(e.id),
  };
}

function deriveAlerts(args: {
  trip: Trip;
  flights: FlightBookingSummary[];
  stays: StayBookingSummary[];
  esims: EsimSummary[];
}): TripBriefAlert[] {
  const alerts: TripBriefAlert[] = [];

  if (args.trip.status === 'canceled') {
    alerts.push({
      kind: 'trip_canceled',
      severity: 'critical',
      message: 'This trip has been canceled.',
    });
  }

  if (
    args.flights.length === 0 &&
    args.stays.length === 0 &&
    args.esims.length === 0 &&
    args.trip.status !== 'completed' &&
    args.trip.status !== 'canceled'
  ) {
    alerts.push({
      kind: 'no_bookings',
      severity: 'info',
      message: 'No bookings yet — start with a flight or hotel search.',
    });
  }

  for (const flight of args.flights) {
    if (flight.status === 'canceled' || flight.status === 'refunded') {
      alerts.push({
        kind: 'flight_canceled',
        severity: 'warn',
        message: `Flight ${flight.pnr ?? flight.bookingId} is ${flight.status}.`,
      });
    }
  }

  // eSIM near-zero alert: status === 'active' AND expiring soon.
  // Real "near-zero data" requires a live usage poll; surface
  // expiry-soon (cheap) and let the agent ask before booking another.
  const now = Date.now();
  const SOON_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
  for (const e of args.esims) {
    if (!e.expiresAt) continue;
    const expiresMs = new Date(e.expiresAt).getTime();
    if (expiresMs > now && expiresMs - now < SOON_MS) {
      alerts.push({
        kind: 'esim_expiring',
        severity: 'warn',
        message: `eSIM ${e.countries.join('/') || 'plan'} expires within 3 days.`,
      });
    }
  }

  return alerts;
}

// ── Orchestrator ─────────────────────────────────────────────────────

function shouldIncludeSection(
  requested: TripBriefSection[] | undefined,
  section: TripBriefSection
): boolean {
  if (!requested || requested.length === 0) return true;
  return requested.includes('all') || requested.includes(section);
}

export async function runGetTripBrief(
  input: GetTripBriefInput,
  deps: GetTripBriefDeps = dbDependencies
): Promise<GetTripBriefResult> {
  const trip = await deps.loadTrip(input.tripId);
  if (!trip) return { status: 'not_found', tripId: input.tripId };

  const includeFlights = shouldIncludeSection(input.sections, 'flights');
  const includeStays = shouldIncludeSection(input.sections, 'stays');
  const includeEsims = shouldIncludeSection(input.sections, 'esim');

  // Bookings query is shared between flights + stays branches; load
  // once when either is requested.
  let flights: FlightBookingSummary[] = [];
  let stays: StayBookingSummary[] = [];
  if (includeFlights || includeStays) {
    const bookings = await deps.loadBookings(input.tripId);
    if (includeFlights) {
      flights = bookings.filter(b => (b.kind as BookingKind) === 'flight').map(summarizeFlight);
    }
    if (includeStays) {
      stays = bookings.filter(b => (b.kind as BookingKind) === 'hotel').map(summarizeStay);
    }
  }

  let esims: EsimSummary[] = [];
  if (includeEsims) {
    const esimRows = await deps.loadEsims(input.tripId);
    esims = await Promise.all(esimRows.map(e => summarizeEsim(e, deps.buildEsimInstallUrl)));
  }

  const alerts = deriveAlerts({ trip, flights, stays, esims });

  // Read trip header from canonical Trip + intent JSON. Mirrors the
  // shape `get_active_trip` returns so the agent can parse either tool's
  // output the same way.
  const intent = (trip.intent ?? {}) as {
    name?: string;
    origin?: string;
    destination?: string;
    destinationIso2?: string[] | string;
    startDate?: string;
    endDate?: string;
  };
  const destinationCountriesIso2 = Array.isArray(intent.destinationIso2)
    ? intent.destinationIso2
        .filter((c): c is string => typeof c === 'string')
        .map(c => c.toLowerCase())
    : typeof intent.destinationIso2 === 'string'
      ? [intent.destinationIso2.toLowerCase()]
      : [];

  const header: TripBriefHeader = {
    tripId: trip.id,
    name: intent.name ?? null,
    status: trip.status,
    kind: trip.kind,
    origin: intent.origin ?? null,
    destination: intent.destination ?? null,
    destinationCountriesIso2,
    startDate: intent.startDate ?? null,
    endDate: intent.endDate ?? null,
  };

  const shareUrl = await deps.buildShareUrl({ tripId: trip.id, tenantId: trip.tenantId });

  // Track which sections were actually computed — both for downstream
  // renderers (Slack only emits a block for sections present) and for
  // an honest agent reply ("here's flights + stays — ask if you want
  // weather + visa requirements too").
  const sectionsIncluded: TripBriefSection[] = [];
  if (includeFlights) sectionsIncluded.push('flights');
  if (includeStays) sectionsIncluded.push('stays');
  if (includeEsims) sectionsIncluded.push('esim');
  // weather + requirements not yet wired — surfaced when agent calls
  // the dedicated tools and stitches into the same brief.

  return {
    status: 'ok',
    trip: header,
    flights,
    stays,
    esims,
    alerts,
    shareUrl,
    sectionsIncluded,
  };
}

export const getTripBriefTool: ToolDef<GetTripBriefInput, GetTripBriefResult> = {
  name: 'get_trip_brief',
  description:
    'Single-call canonical recap of a trip: flights, stays, eSIMs, alerts, and a public share URL. Use this when the traveler asks "what is my trip / show me my trip / where are we at" — beats stitching get_active_trip + list_flight_ancillaries + esim status by hand. Pass `sections` to filter (e.g. ["flights"] for a flight-only refresh); omit for everything. Returns `status: not_found` when the trip ID is unknown — never fabricates.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['tripId'],
    properties: {
      tripId: { type: 'string' },
      sections: {
        type: 'array',
        items: { type: 'string', enum: [...SECTION_VALUES] },
        description:
          'Filter sections. Omit for all. Use ["flights"] for a flight-only refresh, ["esim"] for connectivity status, etc.',
      },
    },
  },
  handler: async (input: GetTripBriefInput) => runGetTripBrief(input),
};
