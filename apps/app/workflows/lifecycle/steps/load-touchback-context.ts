/**
 * Load the trip + first-segment-departure info needed by
 * `concierge-touchback`. Returns the FIRST segment's `departureAt`
 * (the outbound leg) — that's what T-48h is computed against.
 *
 * Returns `null` when the trip can't be found; returns `{ skipReason }`
 * when the workflow should bail (already terminal, no departure data,
 * touch-1 already sent).
 *
 * Spec: docs/architecture/concierge-magic.md §6.2.
 */

import { prisma } from '@sendero/database';

export interface TouchbackContext {
  tripId: string;
  tenantId: string;
  travelerId: string;
  destinationLabel: string;
  destinationIata: string | null;
  destinationIso2: string | null;
  /** ISO-8601 — first ticketed segment's departureAt. */
  firstSegmentDepartureAt: string | null;
  skipReason?:
    | 'already_terminal'
    | 'no_departure_data'
    | 'already_sent'
    | 'no_traveler';
}

export const loadTouchbackContext = async (args: {
  tripId: string;
  tenantId: string;
}): Promise<TouchbackContext | null> => {
  'use step';

  const trip = await prisma.trip.findUnique({
    where: { id: args.tripId },
    select: {
      id: true,
      tenantId: true,
      status: true,
      travelerId: true,
      metadata: true,
      bookings: {
        where: { status: 'ticketed' },
        // Oldest first so segments[0] is the OUTBOUND leg.
        orderBy: { bookedAt: 'asc' },
        take: 1,
        select: { segments: true },
      },
    },
  });
  if (!trip) return null;
  if (trip.tenantId !== args.tenantId) return null;
  if (!trip.travelerId) {
    return {
      tripId: trip.id,
      tenantId: trip.tenantId,
      travelerId: '',
      destinationLabel: '',
      destinationIata: null,
      destinationIso2: null,
      firstSegmentDepartureAt: null,
      skipReason: 'no_traveler',
    };
  }

  const base = {
    tripId: trip.id,
    tenantId: trip.tenantId,
    travelerId: trip.travelerId,
  };

  // Already terminal — nothing to touch back about.
  if (trip.status === 'completed' || trip.status === 'canceled' || trip.status === 'failed') {
    return {
      ...base,
      destinationLabel: '',
      destinationIata: null,
      destinationIso2: null,
      firstSegmentDepartureAt: null,
      skipReason: 'already_terminal',
    };
  }

  // Idempotency: if Touch-1 already fired for this trip, skip silently.
  // book_flight may queue duplicate watchers (round-trip = 1 booking,
  // multi-leg open_journey = N kickoffs), they all converge here.
  const meta = (trip.metadata ?? {}) as Record<string, unknown>;
  const checklist = meta.ancillaryChecklist as Record<string, unknown> | undefined;
  if (checklist?.touchBackSentAt) {
    return {
      ...base,
      destinationLabel: '',
      destinationIata: null,
      destinationIso2: null,
      firstSegmentDepartureAt: null,
      skipReason: 'already_sent',
    };
  }

  const booking = trip.bookings[0];
  const segs = Array.isArray(booking?.segments)
    ? (booking.segments as Array<Record<string, unknown>>)
    : [];
  const firstSeg = segs[0] ?? null;
  const departureAt =
    typeof firstSeg?.departureAt === 'string'
      ? (firstSeg.departureAt as string)
      : typeof firstSeg?.departure_at === 'string'
        ? (firstSeg.departure_at as string)
        : null;
  const destinationIata =
    typeof firstSeg?.destinationIata === 'string'
      ? (firstSeg.destinationIata as string)
      : typeof firstSeg?.destination === 'string'
        ? (firstSeg.destination as string)
        : null;
  const destinationCity =
    typeof firstSeg?.destinationCity === 'string'
      ? (firstSeg.destinationCity as string)
      : null;
  const destinationIso2 =
    typeof firstSeg?.destinationIso2 === 'string'
      ? (firstSeg.destinationIso2 as string)
      : typeof firstSeg?.destinationCountry === 'string'
        ? (firstSeg.destinationCountry as string)
        : null;

  if (!departureAt) {
    return {
      ...base,
      destinationLabel: destinationCity ?? destinationIata ?? 'tu destino',
      destinationIata,
      destinationIso2,
      firstSegmentDepartureAt: null,
      skipReason: 'no_departure_data',
    };
  }

  return {
    ...base,
    destinationLabel: destinationCity ?? destinationIata ?? 'tu destino',
    destinationIata,
    destinationIso2,
    firstSegmentDepartureAt: departureAt,
  };
};
