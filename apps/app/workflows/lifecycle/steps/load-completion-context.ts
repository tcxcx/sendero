/**
 * Load the trip + last-booking arrival info needed by
 * `watch-trip-completion`. Returns the latest segment's `arrivalAt`
 * + a destination label for the prompt copy. Returns `null` when the
 * trip can't be found; returns `{ skipReason }` when the watcher
 * should bail (open_journey, no arrival data, already terminal).
 */

import { prisma } from '@sendero/database';

export interface CompletionContext {
  tripId: string;
  tenantId: string;
  travelerId: string;
  destinationLabel: string;
  destinationIata: string | null;
  /** ISO-8601 — last segment's `arrivalAt`. Null when unknown. */
  lastArrivalAt: string | null;
  skipReason?: 'open_journey' | 'already_terminal' | 'no_arrival_data';
}

export const loadCompletionContext = async (args: {
  tripId: string;
  tenantId: string;
}): Promise<CompletionContext | null> => {
  'use step';

  const trip = await prisma.trip.findUnique({
    where: { id: args.tripId },
    select: {
      id: true,
      tenantId: true,
      kind: true,
      status: true,
      travelerId: true,
      bookings: {
        where: { status: 'ticketed' },
        orderBy: { bookedAt: 'desc' },
        take: 1,
        select: { segments: true },
      },
    },
  });
  if (!trip) return null;
  if (trip.tenantId !== args.tenantId) return null;
  if (!trip.travelerId) return null;

  const base: Omit<CompletionContext, 'skipReason' | 'lastArrivalAt' | 'destinationLabel' | 'destinationIata'> = {
    tripId: trip.id,
    tenantId: trip.tenantId,
    travelerId: trip.travelerId,
  };

  // open_journey trips auto-complete via the going-home detection in
  // book_flight — no watcher needed. Skip cleanly.
  if (trip.kind === 'open_journey') {
    return {
      ...base,
      destinationLabel: '',
      destinationIata: null,
      lastArrivalAt: null,
      skipReason: 'open_journey',
    };
  }

  // Already terminal (completed / canceled / failed) — nothing to watch.
  if (trip.status === 'completed' || trip.status === 'canceled' || trip.status === 'failed') {
    return {
      ...base,
      destinationLabel: '',
      destinationIata: null,
      lastArrivalAt: null,
      skipReason: 'already_terminal',
    };
  }

  // Pull arrivalAt + destination from the last ticketed booking's
  // last segment. Round-trip bookings have multiple segments — take
  // the last one (the inbound leg's arrival).
  const booking = trip.bookings[0];
  const segs = Array.isArray(booking?.segments)
    ? (booking.segments as Array<Record<string, unknown>>)
    : [];
  const lastSeg = segs[segs.length - 1] ?? null;
  const arrivalAt =
    typeof lastSeg?.arrivalAt === 'string'
      ? lastSeg.arrivalAt
      : typeof lastSeg?.arrival_at === 'string'
        ? (lastSeg.arrival_at as string)
        : null;
  const destinationIata =
    typeof lastSeg?.destinationIata === 'string'
      ? (lastSeg.destinationIata as string)
      : typeof lastSeg?.destination === 'string'
        ? (lastSeg.destination as string)
        : null;
  const destinationCity =
    typeof lastSeg?.destinationCity === 'string'
      ? (lastSeg.destinationCity as string)
      : null;

  if (!arrivalAt) {
    return {
      ...base,
      destinationLabel: destinationCity ?? destinationIata ?? 'tu destino',
      destinationIata,
      lastArrivalAt: null,
      skipReason: 'no_arrival_data',
    };
  }

  return {
    ...base,
    destinationLabel: destinationCity ?? destinationIata ?? 'tu destino',
    destinationIata,
    lastArrivalAt: arrivalAt,
  };
};
