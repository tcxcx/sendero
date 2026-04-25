/**
 * /dashboard/console — the canonical MetaInbox.
 *
 * Two modes routed by `?tripId=`:
 *   - Unscoped: operator ↔ Sendero AI. INTERNAL · OPERATOR watermark,
 *     midnight Sendero-AI header, terminal composer.
 *   - Scoped:   operator ↔ traveler via the trip's primary channel.
 *     Channel-tinted header, customer-bubble messages tagged with
 *     "via {channel} · {time}", channel-tinted composer.
 *
 * Server-side fetch:
 *   - Trip list (left rail) — recent trips for the current tenant.
 *   - Focused trip's events JSON → ConversationEntry[].
 *
 * The previous workspace shell (`ClerkSenderoApp`) was a single
 * agent-chat surface without trip context.  The redesign matches the
 * canonical `route-artboards.jsx::MetaInbox` from the design canvas.
 */

import { prisma } from '@sendero/database';
import type { Prisma } from '@sendero/database';

import { type ConversationEntry, MetaInbox } from '@/components/console/meta-inbox';
import type { TripRowData, TripState } from '@/components/console/trip-rail';
import { stringFromJson } from '@/lib/format';
import { requireCurrentTenant } from '@/lib/tenant-context';

export const dynamic = 'force-dynamic';

interface ConsolePageProps {
  searchParams: Promise<{ tripId?: string }>;
}

export default async function ConsolePage(props: ConsolePageProps) {
  const params = await props.searchParams;
  const scopedTripId = params.tripId ?? null;
  const { tenant } = await requireCurrentTenant();

  // 12 most-recent trips (left rail).  Channel is read from the
  // traveler's primary ChannelIdentity — fall back to 'web' when the
  // traveler hasn't linked a phone.
  const recentTrips = await prisma.trip.findMany({
    where: { tenantId: tenant.id },
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

  const tripsForRail: TripRowData[] = recentTrips.map(t => {
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

  let conversation: ConversationEntry[] = [];
  let traveler: { name: string; initials: string } | null = null;
  let holdExpires: string | null = null;

  if (scopedTripId) {
    const focused = recentTrips.find(t => t.id === scopedTripId);
    if (focused) {
      conversation = eventsToConversation(focused.events);
      const name = focused.traveler?.displayName ?? focused.traveler?.email ?? 'Traveler';
      traveler = { name, initials: initials(name) };
      holdExpires = focused.status === 'awaiting_approval' ? null : null;
    }
  } else {
    // Internal-mode: seed with a system intro until the operator chats.
    conversation = [
      {
        id: 'sys-intro',
        role: 'system',
        body: 'Sendero AI · operator console · nothing here is sent to customers · run reports, change policy, ask anything',
      },
    ];
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col">
      <MetaInbox
        trips={tripsForRail}
        scopedTripId={scopedTripId}
        conversation={conversation}
        traveler={traveler}
        holdExpires={holdExpires}
      />
    </div>
  );
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

function eventsToConversation(events: Prisma.JsonValue): ConversationEntry[] {
  if (!Array.isArray(events)) return [];
  return events
    .map((raw, i): ConversationEntry | null => {
      if (!raw || typeof raw !== 'object') return null;
      const r = raw as Record<string, unknown>;
      const id = typeof r.id === 'string' ? r.id : `evt-${i}`;
      const text = typeof r.text === 'string' ? r.text : undefined;
      const t =
        typeof r.createdAt === 'string'
          ? r.createdAt.slice(11, 16)
          : typeof r.t === 'string'
            ? r.t
            : undefined;
      const direction = typeof r.direction === 'string' ? r.direction : null;
      const channel = typeof r.channel === 'string' ? r.channel : undefined;
      const kind = typeof r.kind === 'string' ? r.kind : null;
      if (kind === 'inbox_reply' && direction === 'outbound') {
        return { id, role: 'op', body: text, t };
      }
      if (kind === 'inbox_reply' && direction === 'inbound') {
        return {
          id,
          role: 'customer',
          body: text,
          t,
          channel: (channel as ConversationEntry['channel']) ?? 'web',
        };
      }
      if (kind === 'agent_reply' || direction === 'agent') {
        return { id, role: 'ai', body: text, t };
      }
      if (kind === 'tool_call') {
        return {
          id,
          role: 'tool',
          toolName: typeof r.toolName === 'string' ? r.toolName : 'tool',
          toolArgs: typeof r.toolArgs === 'string' ? r.toolArgs : undefined,
          toolCost: typeof r.priceMicroUsdc === 'string' ? `$${r.priceMicroUsdc}` : undefined,
        };
      }
      if (text) return { id, role: 'op', body: text, t };
      return null;
    })
    .filter((e): e is ConversationEntry => e !== null);
}
