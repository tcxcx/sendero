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

import {
  buildSendableTravelerChannels,
  selectSendableTravelerChannel,
} from '@/lib/sendable-traveler-channels';
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
  /**
   * Sendable channel destinations bound to the traveler. Header chips render
   * one entry per destination so a dual-channel traveler surfaces both in the
   * console header. Empty when traveler is null.
   */
  channels: Array<{ kind: string; handle: string | null }>;
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
      channels: [],
    };
  }

  const focused = await prisma.trip.findFirst({
    where: { id: scopedTripId, tenantId },
    select: {
      events: true,
      channelBindings: true,
      traveler: {
        select: {
          displayName: true,
          email: true,
          channelIdentities: {
            where: { tenantId },
            select: {
              kind: true,
              externalUserId: true,
              businessScopedUserId: true,
              username: true,
              tenantId: true,
            },
            // No `take` — we want every bound channel so the header
            // can surface multi-channel travelers (e.g. Slack + WhatsApp).
          },
          slackUserBindings: {
            where: { tenantId },
            select: {
              slackTeamId: true,
              slackUserId: true,
            },
          },
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
      channels: [],
    };
  }

  const conversation = eventsToUnifiedMessages(focused.events);
  const name = focused.traveler?.displayName ?? focused.traveler?.email ?? 'Traveler';
  const traveler = { name, initials: initials(name) };
  const currentTenantSlackBindings = focused.traveler?.slackUserBindings ?? [];
  let activeSlackTeamIds = new Set<string>();
  if (currentTenantSlackBindings.length > 0) {
    const activeSlackInstalls = await prisma.slackInstall.findMany({
      where: {
        tenantId,
        revokedAt: null,
        teamId: { in: currentTenantSlackBindings.map(binding => binding.slackTeamId) },
      },
      select: { teamId: true },
    });
    activeSlackTeamIds = new Set(activeSlackInstalls.map(install => install.teamId));
  }
  const channels = buildSendableTravelerChannels({
    channelIdentities: focused.traveler?.channelIdentities ?? [],
    slackUserBindings: currentTenantSlackBindings,
    activeSlackTeamIds,
  });
  const bindings = (focused.channelBindings ?? null) as { primary?: string } | null;
  const channelKind = selectSendableTravelerChannel(channels, bindings?.primary) ?? 'web';

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

  return { conversation, traveler, holdExpires: null, pendingBooking, channelKind, channels };
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
