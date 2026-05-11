/**
 * Phase B — trip rail loader, extracted from `console-data` so the
 * `@threads` parallel-routes slot can fetch independently of the
 * focused conversation. The rail paints with the 12 most-recently
 * touched trips; the conversation slot fetches the focused trip's
 * events log on its own.
 *
 * Why split: `loadConsoleData` was a single sequential function
 * doing rail + focused + KPIs. Even after KPIs split into
 * `console-kpis.ts`, the rail and the focused-trip fetch waited on
 * each other inside `console-data.loadConsoleData`. Lifting the
 * rail into its own loader lets the slot stream in as soon as the
 * 12-row trip list lands — independent of the (potentially heavier)
 * events JSON of the focused trip.
 */

import { prisma } from '@sendero/database';
import type { Prisma } from '@sendero/database';

import type { TripRowData, TripState } from '@/components/console/trip-rail';
import { stringFromJson } from '@/lib/format';
import {
  buildSendableTravelerChannels,
  selectSendableTravelerChannel,
} from '@/lib/sendable-traveler-channels';

export async function loadConsoleTrips(
  tenantId: string,
  scopedTripId: string | null
): Promise<TripRowData[]> {
  const activeSlackInstalls = await prisma.slackInstall.findMany({
    where: { tenantId, revokedAt: null },
    select: { teamId: true },
  });
  const activeSlackTeamIds = new Set(activeSlackInstalls.map(install => install.teamId));

  const recentTrips = await prisma.trip.findMany({
    where: { tenantId },
    orderBy: { updatedAt: 'desc' },
    take: 12,
    select: {
      id: true,
      status: true,
      intent: true,
      metadata: true,
      updatedAt: true,
      events: true,
      traveler: {
        select: {
          displayName: true,
          email: true,
          channelIdentities: {
            where: { tenantId },
            select: { kind: true },
          },
          slackUserBindings: {
            where: { tenantId },
            select: { slackTeamId: true, slackUserId: true },
          },
        },
      },
    },
  });

  const trips: TripRowData[] = recentTrips.map(t => mapToRow(t, activeSlackTeamIds));

  // Deep-link to a trip outside the 12-most-recent slice: backfill
  // the row so the rail shows the currently-focused trip even when
  // it's old. Mirrors the original behavior in `console-data`.
  const inSlice = scopedTripId ? trips.some(t => t.id === scopedTripId) : true;
  if (scopedTripId && !inSlice) {
    const focused = await prisma.trip.findFirst({
      where: { id: scopedTripId, tenantId },
      select: {
        id: true,
        status: true,
        intent: true,
        metadata: true,
        updatedAt: true,
        events: true,
        traveler: {
          select: {
            displayName: true,
            email: true,
            channelIdentities: {
              where: { tenantId },
              select: { kind: true },
            },
            slackUserBindings: {
              where: { tenantId },
              select: { slackTeamId: true, slackUserId: true },
            },
          },
        },
      },
    });
    if (focused) trips.unshift(mapToRow(focused, activeSlackTeamIds));
  }

  return trips;
}

type TripQueryRow = {
  id: string;
  status: string;
  intent: Prisma.JsonValue;
  metadata: Prisma.JsonValue;
  updatedAt: Date;
  events: Prisma.JsonValue;
  traveler: {
    displayName: string | null;
    email: string | null;
    channelIdentities: Array<{ kind: string }>;
    slackUserBindings: Array<{ slackTeamId: string; slackUserId: string }>;
  } | null;
};

function mapToRow(t: TripQueryRow, activeSlackTeamIds: Set<string>): TripRowData {
  const intent =
    t.intent && typeof t.intent === 'object' ? (t.intent as Record<string, unknown>) : {};
  const route =
    intent.origin && intent.destination ? `${intent.origin} → ${intent.destination}` : '—';
  const tail = lastEventBody(t.events) ?? stringFromJson(t.metadata, 'tripSummary', '');
  const channel = pickRailChannel(t.traveler, activeSlackTeamIds);
  return {
    id: t.id,
    who: t.traveler?.displayName ?? t.traveler?.email ?? 'Traveler',
    route,
    state: tripStateFromStatus(t.status),
    tone: toneFromStatus(t.status),
    mins: shortTime(t.updatedAt),
    body: tail || 'No activity yet',
    channel,
  };
}

function pickRailChannel(
  traveler: TripQueryRow['traveler'],
  activeSlackTeamIds: Set<string>
): string {
  if (!traveler) return 'web';
  return (
    selectSendableTravelerChannel(
      buildSendableTravelerChannels({
        channelIdentities: traveler.channelIdentities,
        slackUserBindings: traveler.slackUserBindings,
        activeSlackTeamIds,
      })
    ) ?? 'web'
  );
}

function tripStateFromStatus(status: string): TripState {
  switch (status) {
    case 'awaiting_approval':
      return 'AWAITING';
    case 'booked':
    case 'in_progress':
    case 'completed':
      return 'SETTLED';
    case 'searching':
      return 'SEARCH';
    case 'failed':
    case 'canceled':
      return 'OVER CAP';
    default:
      return 'HOLD';
  }
}

function toneFromStatus(status: string): TripRowData['tone'] {
  switch (status) {
    case 'awaiting_approval':
      return 'verm';
    case 'booked':
    case 'in_progress':
    case 'completed':
      return 'sea';
    case 'failed':
    case 'canceled':
      return 'sand';
    default:
      return 'outline';
  }
}

function shortTime(d: Date | null | undefined): string {
  if (!d) return '';
  const now = Date.now();
  const ms = now - d.getTime();
  if (ms < 24 * 60 * 60 * 1000) return d.toTimeString().slice(0, 5);
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days < 7) return `${days}d`;
  return d.toISOString().slice(5, 10);
}

function lastEventBody(events: Prisma.JsonValue): string | null {
  if (!Array.isArray(events) || events.length === 0) return null;
  const last = events[events.length - 1];
  if (last && typeof last === 'object' && 'text' in last) {
    const text = (last as Record<string, unknown>).text;
    return typeof text === 'string' ? text.slice(0, 80) : null;
  }
  return null;
}
