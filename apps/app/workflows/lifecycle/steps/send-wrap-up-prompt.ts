/**
 * Send the post-trip wrap-up interactive button card to the traveler.
 * Two buttons:
 *   - `trip_wrap:<tripId>` → agent calls `complete_trip`
 *   - `trip_extend:<tripId>` → agent calls `set_trip_kind({kind: 'open_journey'})`
 *
 * Fail-soft: missing identity / install / send failure all log + return.
 */

import { randomUUID } from 'node:crypto';

import { prisma } from '@sendero/database';

import { dispatchToTraveler } from '@/lib/channel-dispatch';

export const sendWrapUpPrompt = async (args: {
  tripId: string;
  tenantId: string;
}): Promise<void> => {
  'use step';

  try {
    // Re-fetch the trip + booking so we use the freshest arrival info
    // (in case the booking was updated mid-flight between the
    // load-completion-context step and now).
    const trip = await prisma.trip.findUnique({
      where: { id: args.tripId },
      select: {
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
    if (!trip?.travelerId) return;
    if (trip.status === 'completed' || trip.status === 'canceled' || trip.status === 'failed') {
      // Trip already closed before the prompt — skip silently.
      return;
    }

    const segs = Array.isArray(trip.bookings[0]?.segments)
      ? (trip.bookings[0].segments as Array<Record<string, unknown>>)
      : [];
    const last = segs[segs.length - 1] ?? null;
    const destinationLabel =
      (typeof last?.destinationCity === 'string' && last.destinationCity) ||
      (typeof last?.destinationIata === 'string' && last.destinationIata) ||
      'tu destino';

    const result = await dispatchToTraveler({
      tripId: args.tripId,
      tenantId: args.tenantId,
      travelerUserId: trip.travelerId,
      message: {
        kind: 'card',
        id: randomUUID(),
        author: { role: 'agent', name: 'Sendero' },
        title: '¿Volviste de tu viaje?',
        body: `*Welcome back from ${destinationLabel}!*\n\n¿Cómo estuvo? Tap below to wrap up + mint your TripPassport NFT — or, if you're still on the road, switch to open-journey mode and keep adding legs.`,
        ctas: [
          {
            label: '✅ Wrap up · NFT',
            kind: 'tool_invoke',
            value: `trip_wrap:${args.tripId}`,
            emphasis: 'primary',
          },
          {
            label: '✈️ Still traveling',
            kind: 'tool_invoke',
            value: `trip_extend:${args.tripId}`,
            emphasis: 'secondary',
          },
        ],
        createdAt: new Date().toISOString(),
      },
    });
    if (result.sent === false) {
      console.warn('[trip-wrap-up] dispatch skipped', {
        tripId: args.tripId,
        reason: result.reason,
        channel: result.channel,
      });
    }
  } catch (err) {
    console.warn('[trip-wrap-up] send failed (non-fatal)', {
      tripId: args.tripId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
