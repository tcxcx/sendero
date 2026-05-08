/**
 * Phase B-γ — focused-trip loader for the `@conversation` slot.
 *
 * Server-fetches just the data the conversation column needs for the
 * scoped trip: the events log (to seed the AI Elements stream), the
 * traveler display info (for the bubble avatars), the earliest
 * pending booking (for the SettleHoldButton in the header), and a
 * stub `holdExpires` placeholder kept for shape parity with the old
 * `loadConsoleData`.
 *
 * Unscoped (no tripId): seeds the conversation column with the
 * `sys-intro` welcome line so the operator console paints the
 * "Sendero AI · operator console · nothing here is sent to customers"
 * banner at the top of the message list.
 *
 * The trip rail data (12 most-recent trips) is loaded by
 * `loadConsoleTrips` for the `@threads` slot — this loader does NOT
 * duplicate that query.
 */

import { prisma } from '@sendero/database';

import { eventsToUnifiedMessages, type UnifiedMessage } from '@/lib/unified-message';

export interface FocusedTripData {
  /** Server-rendered conversation (events log → unified messages). */
  conversation: UnifiedMessage[];
  /** Traveler display info for bubble avatars + scoped header. */
  traveler: { name: string; initials: string } | null;
  /** Hold-expires countdown ("59:48") when status === 'awaiting hold'. */
  holdExpires: string | null;
  /** Earliest pending booking on the trip; drives the SettleHoldButton. */
  pendingBooking: { id: string; totalUsd: string } | null;
  /** Primary channel kind of the trip's traveler; used to tint the composer. */
  channelKind: string | null;
}

export async function loadFocusedTrip(
  tenantId: string,
  scopedTripId: string | null
): Promise<FocusedTripData> {
  if (!scopedTripId) {
    return {
      conversation: [
        {
          id: 'sys-intro',
          at: new Date().toISOString(),
          channel: 'internal',
          direction: 'internal',
          kind: 'system_note',
          author: { kind: 'system' },
          body: 'Sendero AI · operator console · nothing here is sent to customers · run reports, change policy, ask anything',
        },
      ],
      traveler: null,
      holdExpires: null,
      pendingBooking: null,
      channelKind: null,
    };
  }

  const focused = await prisma.trip.findFirst({
    where: { id: scopedTripId, tenantId },
    select: {
      events: true,
      traveler: {
        select: {
          displayName: true,
          email: true,
          channelIdentities: { select: { kind: true }, take: 1 },
        },
      },
    },
  });

  if (!focused) {
    return {
      conversation: [],
      traveler: null,
      holdExpires: null,
      pendingBooking: null,
      channelKind: null,
    };
  }

  const conversation = eventsToUnifiedMessages(focused.events);
  const name = focused.traveler?.displayName ?? focused.traveler?.email ?? 'Traveler';
  const traveler = { name, initials: initials(name) };
  const channelKind = focused.traveler?.channelIdentities[0]?.kind ?? 'web';

  const earliestPending = await prisma.booking.findFirst({
    where: { tripId: scopedTripId, tenantId, status: 'pending' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, totalUsd: true },
  });

  let pendingBooking: FocusedTripData['pendingBooking'] = null;
  if (earliestPending && Number(earliestPending.totalUsd.toString()) > 0) {
    pendingBooking = {
      id: earliestPending.id,
      totalUsd: earliestPending.totalUsd.toString(),
    };
  }

  return { conversation, traveler, holdExpires: null, pendingBooking, channelKind };
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .map(w => w[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase() || 'TR'
  );
}
