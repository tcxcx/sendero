/**
 * get_active_trip — return the most recently active trip for the
 * resolved traveler. Closes the cross-turn-context gap that bit
 * the WhatsApp dogfood: Kapso's per-execution `vars` are wiped at
 * end-of-execution, and conversation history depth is bounded so
 * earlier interactive cards push prior turns out of view. Calling
 * `get_active_trip` first thing in a thread (immediately after
 * `get_whatsapp_context`) lets the agent stash tripId + destinations
 * + dates + latest booking PNR via `save_variable`, so downstream
 * tools (book_esim, complete_trip, trip_weather_brief, etc.) always
 * have the right anchor regardless of how many cards rolled past.
 *
 * Source of truth: Sendero Postgres `Trip` row joined to its most
 * recent `Booking` (when one exists). Returns the destination as
 * BOTH ISO-2 codes (for tools that need them — book_esim) and the
 * city / country names captured in `Booking.segments`. Never
 * fabricates: when no trip is on file, returns
 * `{ status: 'no_active_trip' }` so the agent prompts for the
 * destination instead of guessing.
 */

import { z } from 'zod';

import { prisma } from '@sendero/database';

import type { ToolContext, ToolDef } from './types';

const inputSchema = z
  .object({
    /**
     * Optional. When set, the agent is asking about a specific trip
     * (e.g. user mentioned "the trip to Tokyo"). When unset, return
     * the most recent active trip — booked-or-later before draft.
     */
    tripId: z.string().optional(),
  })
  .strict();

export type GetActiveTripInput = z.infer<typeof inputSchema>;

export interface GetActiveTripResult {
  status: 'ok' | 'no_traveler' | 'no_active_trip';
  message?: string;
  trip?: {
    tripId: string;
    /** Trip lifecycle status. */
    state: string;
    origin: string | null;
    destination: string | null;
    /**
     * ISO-3166-1 alpha-2 country codes covered by this trip's bookings.
     * Derived from `Booking.segments[].arrival.iata_country_code` when
     * present, falling back to `Trip.intent.destinationIso2` when the
     * tenant agent stamped one at intake. Always lowercase-deduped.
     */
    destinationCountriesIso2: string[];
    /** ISO-8601 date strings — Trip.intent.startDate / endDate. */
    startDate: string | null;
    endDate: string | null;
    purpose: string | null;
    paymentMode: string | null;
    /** Phase B.2 — `one_way` / `round_trip` / `open_journey`. */
    kind: 'one_way' | 'round_trip' | 'open_journey';
    /**
     * Phase B.2 — where the traveler currently is. Last destination
     * IATA from the most recent ticketed booking's last segment.
     * For an open_journey trip, this is what `book_flight` should
     * default `origin` to ("from where I am now"). Null when no
     * booking has landed yet.
     */
    currentLocation: string | null;
    /**
     * Phase B.2 — traveler's home airport IATA from `User.homeIata`.
     * What `take_me_home` resolves to. Null when the traveler hasn't
     * declared a home yet.
     */
    homeIata: string | null;
    /**
     * Phase B.2 — every booking on this trip in chronological order
     * (oldest first). Lets the agent recap "A → B → C, where next?"
     * for an open journey. Capped at 20.
     */
    bookings: Array<{
      bookingId: string;
      kind: string;
      status: string;
      pnr: string | null;
      bookedAt: string | null;
      origin: string | null;
      destination: string | null;
    }>;
    latestBooking: {
      bookingId: string;
      kind: string;
      status: string;
      pnr: string | null;
      bookedAt: string | null;
      carrier: string | null;
      origin: string | null;
      destination: string | null;
    } | null;
  };
}

// Trip lifecycle states that count as "active" — i.e. not yet completed,
// canceled, or failed. Mirrors `TripStatus` in the Prisma schema.
const ACTIVE_STATES = ['draft', 'searching', 'awaiting_approval', 'booked', 'in_progress'] as const;

export async function getActiveTrip(
  input: GetActiveTripInput,
  ctx?: ToolContext
): Promise<GetActiveTripResult> {
  const tenantId = ctx?.traveler?.tenantId;
  const userId = ctx?.traveler?.userId;
  if (!tenantId || !userId) {
    return {
      status: 'no_traveler',
      message:
        'Pass `travelerPhone` on `call_sendero` so Sendero can resolve the trip. Without it I can only reach service-account state.',
    };
  }

  const where = input.tripId
    ? { id: input.tripId, tenantId, travelerId: userId }
    : { tenantId, travelerId: userId, status: { in: [...ACTIVE_STATES] } };

  const trip = await prisma.trip.findFirst({
    where,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      status: true,
      intent: true,
      paymentMode: true,
      kind: true,
      bookings: {
        // Oldest first so the agent reads "A → B → C" in journey order.
        orderBy: { createdAt: 'asc' },
        take: 20,
        select: {
          id: true,
          kind: true,
          status: true,
          pnr: true,
          bookedAt: true,
          rawDuffel: true,
          segments: true,
        },
      },
    },
  });

  // Phase B.2 — pull the traveler's home anchor for `take_me_home`.
  const homeRow = await prisma.user.findUnique({
    where: { id: userId },
    select: { homeIata: true },
  });

  if (!trip) {
    return {
      status: 'no_active_trip',
      message: input.tripId
        ? `No trip found with id=${input.tripId} for this traveler.`
        : 'No active trip on file. Ask the traveler where they are headed and for how many days.',
    };
  }

  const intent = (trip.intent ?? {}) as Record<string, unknown>;
  const origin = stringOrNull(intent.origin, intent.from);
  const destination = stringOrNull(intent.destination, intent.to, intent.dest);
  const startDate = stringOrNull(intent.startDate, intent.depart, intent.dates);
  const endDate = stringOrNull(intent.endDate, intent.return);
  const purpose = stringOrNull(intent.purpose);

  // ISO-2 destination codes — try Trip.intent first, then fall back to
  // segments. We dedupe + uppercase so the consumer (book_esim, etc.)
  // can drop the result straight into the input schema.
  const intentIso = collectIso2(intent.destinationIso2, intent.iso2);
  const fromSegments = trip.bookings[0]
    ? collectIso2FromSegments(trip.bookings[0].segments, trip.bookings[0].rawDuffel)
    : [];
  const destinationCountriesIso2 = uniqueIso2([...intentIso, ...fromSegments]);

  // Bookings are oldest-first now (so journey reads forward). The
  // "latest" booking is the LAST element. `currentLocation` reads
  // from the most recent ticketed booking's last segment destination.
  const latestBooking = trip.bookings.length > 0 ? trip.bookings[trip.bookings.length - 1] : null;
  const segmentSummary = latestBooking ? summarizeBookingSegments(latestBooking.segments) : null;

  // Phase B.2 — current physical location of the traveler. Prefer the
  // most recent TICKETED booking's destination; fall back to the
  // latest booking regardless of status.
  const ticketedBookings = trip.bookings.filter(b => b.status === 'ticketed');
  const lastTicketed =
    ticketedBookings.length > 0 ? ticketedBookings[ticketedBookings.length - 1] : null;
  const currentLocation = lastTicketed
    ? summarizeBookingSegments(lastTicketed.segments)?.destination ?? null
    : segmentSummary?.destination ?? null;

  // Project all bookings for the journey-recap surface.
  const projectedBookings = trip.bookings.map(b => {
    const sum = summarizeBookingSegments(b.segments);
    return {
      bookingId: b.id,
      kind: b.kind,
      status: b.status,
      pnr: b.pnr,
      bookedAt: b.bookedAt ? b.bookedAt.toISOString() : null,
      origin: sum?.origin ?? null,
      destination: sum?.destination ?? null,
    };
  });

  return {
    status: 'ok',
    trip: {
      tripId: trip.id,
      state: trip.status,
      kind: trip.kind as 'one_way' | 'round_trip' | 'open_journey',
      origin,
      destination,
      destinationCountriesIso2,
      startDate,
      endDate,
      purpose,
      paymentMode: trip.paymentMode ?? null,
      currentLocation,
      homeIata: homeRow?.homeIata ?? null,
      bookings: projectedBookings,
      latestBooking: latestBooking
        ? {
            bookingId: latestBooking.id,
            kind: latestBooking.kind,
            status: latestBooking.status,
            pnr: latestBooking.pnr,
            bookedAt: latestBooking.bookedAt ? latestBooking.bookedAt.toISOString() : null,
            carrier: segmentSummary?.carrier ?? null,
            origin: segmentSummary?.origin ?? null,
            destination: segmentSummary?.destination ?? null,
          }
        : null,
    },
  };
}

function stringOrNull(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim().length > 0) return v;
  }
  return null;
}

function collectIso2(...vals: unknown[]): string[] {
  const out: string[] = [];
  for (const v of vals) {
    if (Array.isArray(v)) {
      for (const item of v) {
        if (typeof item === 'string' && item.length === 2) out.push(item);
      }
    } else if (typeof v === 'string' && v.length === 2) {
      out.push(v);
    }
  }
  return out;
}

function uniqueIso2(codes: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of codes) {
    const upper = c.toUpperCase();
    if (!seen.has(upper) && /^[A-Z]{2}$/.test(upper)) {
      seen.add(upper);
      out.push(upper);
    }
  }
  return out;
}

function collectIso2FromSegments(segments: unknown, rawDuffel: unknown): string[] {
  const out: string[] = [];
  // Sendero's normalized `segments` first.
  if (Array.isArray(segments)) {
    for (const s of segments as Array<Record<string, unknown>>) {
      const code = stringOrNull(s.destinationCountry, s.destinationIso2, s.arrivalCountry);
      if (code && code.length === 2) out.push(code);
    }
  }
  // Duffel raw (slices[].segments[].destination.iata_country_code).
  if (rawDuffel && typeof rawDuffel === 'object') {
    const raw = rawDuffel as Record<string, unknown>;
    const slices = Array.isArray(raw.slices) ? (raw.slices as Array<Record<string, unknown>>) : [];
    for (const slice of slices) {
      const segs = Array.isArray(slice.segments)
        ? (slice.segments as Array<Record<string, unknown>>)
        : [];
      for (const seg of segs) {
        const dest = (seg.destination ?? {}) as Record<string, unknown>;
        const code = stringOrNull(dest.iata_country_code, dest.country_code);
        if (code && code.length === 2) out.push(code);
      }
    }
  }
  return out;
}

function summarizeBookingSegments(
  segments: unknown
): { carrier: string | null; origin: string | null; destination: string | null } | null {
  if (!Array.isArray(segments) || segments.length === 0) return null;
  const arr = segments as Array<Record<string, unknown>>;
  const first = arr[0];
  const last = arr[arr.length - 1];
  const carrier = stringOrNull(first?.carrierName, first?.carrier);
  const origin = stringOrNull(first?.originIata, first?.origin);
  const destination = stringOrNull(last?.destinationIata, last?.destination);
  return { carrier, origin, destination };
}

export const getActiveTripTool: ToolDef<GetActiveTripInput, GetActiveTripResult> = {
  name: 'get_active_trip',
  description:
    "Return the most recently active trip for the resolved traveler — destination ISO-2 codes, dates, latest booking PNR. Call this once per thread (right after `get_whatsapp_context`) and stash the result via `save_variable` so book_esim / complete_trip / trip_weather_brief / etc. always have the right tripId regardless of how many interactive cards have scrolled past in the conversation. Returns `{ status: 'ok', trip }` or `{ status: 'no_active_trip' }` so the agent can prompt for the destination instead of guessing.",
  inputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      tripId: {
        type: 'string',
        description:
          'Optional Trip.id when the user references a specific trip. Omit to fetch the most recently active one.',
      },
    },
  },
  async handler(input, ctx) {
    return getActiveTrip(input, ctx);
  },
};
