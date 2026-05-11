/**
 * Shared MetaInbox data loader.
 *
 * Both `/dashboard/console?tripId=…` and `/dashboard/inbox/[tripId]` (and
 * the inbox root) render the same `MetaInbox` component in different
 * scopes. This module is the single source of truth for fetching the
 * left-rail trip list, mapping each trip to a `TripRowData`, and folding
 * the focused trip's `events` JSON log into a `ConversationEntry[]` the
 * UI can render.
 */

import { prisma } from '@sendero/database';
import type { Prisma } from '@sendero/database';

import type { TripRowData, TripState } from '@/components/console/trip-rail';
import { stringFromJson } from '@/lib/format';
import { eventsToUnifiedMessages, type UnifiedMessage } from '@/lib/unified-message';

export interface ConsoleKpis {
  /** Confirmed-or-ticketed Booking count over the last 30d. */
  settled30dCount: number;
  /** Sum of Booking.totalUsd over the same window, formatted as USD ("$74,820"). */
  settled30dFare: string | null;
  /**
   * Median wall-clock gap between an inbound traveler message and the
   * next outbound agent reply, scanned across Trip.events for the
   * tenant's 12 most-recently-touched trips. Null when no pairs land
   * in the window — the hero shows "—" rather than a fake number.
   */
  avgResponseLabel: string | null;
}

export interface ConsoleData {
  trips: TripRowData[];
  conversation: UnifiedMessage[];
  traveler: { name: string; initials: string } | null;
  holdExpires: string | null;
  /**
   * Earliest pending Booking on the scoped trip — drives the "Settle
   * this hold" header CTA. Null when nothing is pending; absent when
   * the inbox is unscoped.
   */
  pendingBooking: { id: string; totalUsd: string } | null;
  /** Workspace-mode header KPIs. Computed once per page load. */
  kpis: ConsoleKpis;
}

export async function loadConsoleData(
  tenantId: string,
  scopedTripId: string | null
): Promise<ConsoleData> {
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
          channelIdentities: { select: { kind: true }, take: 1 },
        },
      },
    },
  });

  const trips: TripRowData[] = recentTrips.map(t => {
    const intent =
      t.intent && typeof t.intent === 'object' ? (t.intent as Record<string, unknown>) : {};
    const route =
      intent.origin && intent.destination ? `${intent.origin} → ${intent.destination}` : '—';
    const tail = lastEventBody(t.events) ?? stringFromJson(t.metadata, 'tripSummary', '');
    const channel = t.traveler?.channelIdentities[0]?.kind ?? 'web';
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
  });

  // If a trip is scoped but isn't in the 12-most-recent slice, fetch it
  // separately so deep-links to older trips still work.
  let focused = scopedTripId ? recentTrips.find(t => t.id === scopedTripId) : null;
  if (scopedTripId && !focused) {
    focused = await prisma.trip.findFirst({
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
            channelIdentities: { select: { kind: true }, take: 1 },
          },
        },
      },
    });
    if (focused) {
      trips.unshift({
        id: focused.id,
        who: focused.traveler?.displayName ?? focused.traveler?.email ?? 'Traveler',
        route: '—',
        state: tripStateFromStatus(focused.status),
        tone: toneFromStatus(focused.status),
        mins: shortTime(focused.updatedAt),
        body: lastEventBody(focused.events) ?? 'No activity yet',
        channel: focused.traveler?.channelIdentities[0]?.kind ?? 'web',
      });
    }
  }

  let conversation: UnifiedMessage[] = [];
  let traveler: { name: string; initials: string } | null = null;
  const holdExpires: string | null = null;
  let pendingBooking: ConsoleData['pendingBooking'] = null;

  if (scopedTripId && focused) {
    conversation = eventsToUnifiedMessages(focused.events);
    const name = focused.traveler?.displayName ?? focused.traveler?.email ?? 'Traveler';
    traveler = { name, initials: initials(name) };
    const earliestPending = await prisma.booking.findFirst({
      where: { tripId: scopedTripId, tenantId, status: 'pending' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, totalUsd: true },
    });
    if (earliestPending && Number(earliestPending.totalUsd.toString()) > 0) {
      pendingBooking = {
        id: earliestPending.id,
        totalUsd: earliestPending.totalUsd.toString(),
      };
    }
  } else if (!scopedTripId) {
    conversation = [
      {
        id: 'sys-intro',
        at: new Date().toISOString(),
        channel: 'internal',
        direction: 'internal',
        kind: 'system_note',
        author: { kind: 'system' },
        body: 'Sendero AI · operator console · nothing here is sent to customers · run reports, change policy, ask anything',
      },
    ];
  }

  const kpis = await computeKpis(tenantId, recentTrips);

  return { trips, conversation, traveler, holdExpires, pendingBooking, kpis };
}

async function computeKpis(
  tenantId: string,
  recentTrips: Array<{ events: Prisma.JsonValue }>
): Promise<ConsoleKpis> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [count, sum] = await Promise.all([
    prisma.booking.count({
      where: {
        tenantId,
        status: { in: ['confirmed', 'ticketed'] },
        bookedAt: { gte: since },
      },
    }),
    prisma.booking.aggregate({
      where: {
        tenantId,
        status: { in: ['confirmed', 'ticketed'] },
        bookedAt: { gte: since },
      },
      _sum: { totalUsd: true },
    }),
  ]);
  const fareNumber = Number(sum._sum.totalUsd?.toString() ?? '0');
  const settled30dFare = count > 0 ? formatUsdCompact(fareNumber) : null;

  // Median inbound→outbound latency across the recent trips' events.
  // Cheaper than aggregating across the whole tenant; this is the
  // operator's working set anyway.
  const gapsMs: number[] = [];
  for (const t of recentTrips) {
    if (!Array.isArray(t.events)) continue;
    let lastInboundAt: number | null = null;
    for (const raw of t.events) {
      if (!raw || typeof raw !== 'object') continue;
      const evt = raw as Record<string, unknown>;
      const direction = evt.direction;
      const at = typeof evt.createdAt === 'string' ? Date.parse(evt.createdAt) : Number.NaN;
      if (Number.isNaN(at)) continue;
      if (direction === 'inbound') {
        lastInboundAt = at;
      } else if (direction === 'outbound' && lastInboundAt !== null) {
        const gap = at - lastInboundAt;
        if (gap > 0 && gap < 60 * 60 * 1000) gapsMs.push(gap);
        lastInboundAt = null;
      }
    }
  }
  const avgResponseLabel = gapsMs.length > 0 ? formatLatency(median(gapsMs)) : null;

  return { settled30dCount: count, settled30dFare, avgResponseLabel };
}

function formatUsdCompact(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '$0';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `$${Math.round(n / 1_000)}k`;
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

function formatLatency(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// ── helpers ─────────────────────────────────────────────────────

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
