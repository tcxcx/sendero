/**
 * Final step of `watch-trip-completion`. Runs 7 days after the
 * wrap-up prompt was sent. Re-checks `Trip.status`: if still
 * `in_progress` / `booked` / `searching` / etc., fires `complete_trip`
 * over the internal HTTP surface — same path the agent uses on the
 * Wrap-up button tap.
 *
 * Idempotent: when the agent already closed the trip via the user's
 * tap (the common case), this step finds the terminal status and
 * returns without firing. The `complete_trip` tool is itself
 * idempotent on `Trip.status` so even concurrent fires can't
 * double-mint a TripPassport.
 */

import { prisma } from '@sendero/database';

export const closeIfStillOpen = async (args: {
  tripId: string;
  tenantId: string;
}): Promise<void> => {
  'use step';

  const trip = await prisma.trip.findUnique({
    where: { id: args.tripId },
    select: {
      status: true,
      travelerId: true,
      tenantId: true,
    },
  });
  if (!trip) return;
  if (trip.tenantId !== args.tenantId) return;
  if (trip.status === 'completed' || trip.status === 'canceled' || trip.status === 'failed') {
    return;
  }
  if (!trip.travelerId) return;

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3010';
  const secret = process.env.AGENT_DISPATCH_SECRET ?? process.env.CRON_SECRET ?? '';
  if (!secret) {
    console.warn('[trip-wrap-up] silent close skipped — no dispatch secret', {
      tripId: args.tripId,
    });
    return;
  }

  // Resolve the traveler's WhatsApp phone so the dispatch route can
  // bind ctx.traveler.userId. complete_trip checks ownership by userId.
  const identity = await prisma.channelIdentity.findFirst({
    where: { tenantId: args.tenantId, userId: trip.travelerId, kind: 'whatsapp' },
    select: { externalUserId: true },
  });
  const phone = identity?.externalUserId;

  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/tools/complete_trip`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-sendero-dispatch-secret': secret,
      },
      body: JSON.stringify({
        tenantId: args.tenantId,
        ...(phone ? { travelerPhone: phone } : {}),
        input: { tripId: args.tripId },
      }),
    });
    if (!res.ok) {
      console.warn('[trip-wrap-up] silent close non-OK', {
        tripId: args.tripId,
        status: res.status,
      });
    }
  } catch (err) {
    console.warn('[trip-wrap-up] silent close fetch failed (non-fatal)', {
      tripId: args.tripId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
