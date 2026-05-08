/**
 * Phase C-2 — Liveblocks bell adapter.
 *
 * Calls Liveblocks `triggerInboxNotification` directly. Each event
 * kind maps to a Liveblocks notification `kind` (the `$` prefix is
 * Liveblocks convention) and a deep-link `url` for the bell row.
 *
 * Per /plan-eng-review E10: real human bells require Clerk user_xxx
 * ids. The adapter passes `recipient.userId` through unchanged; the
 * dispatcher's caller is responsible for resolving valid Clerk user
 * ids (e.g., `request_human_handoff` looks up agency_admin operators
 * for the tenant). When `userId` is the legacy `agent:customer-support`
 * namespace string, the bell fires for the legacy webhook-fanout
 * consumer, NOT a human — kept for compat.
 *
 * No fallback chain inside the adapter — `fallback-chain.ts` is the
 * caller's terminal-state escape hatch. This adapter just reports
 * `ok: true | false` for the dispatch row's status.
 */

import { Liveblocks } from '@liveblocks/node';

import type { ChannelAdapter } from '../dispatch';

let _client: Liveblocks | null = null;
function getClient(): Liveblocks | null {
  if (_client) return _client;
  const secret = process.env.LIVEBLOCKS_SECRET_KEY;
  if (!secret) return null;
  _client = new Liveblocks({ secret });
  return _client;
}

export const liveblocksBellAdapter: ChannelAdapter = async ({ event, recipient }) => {
  const client = getClient();
  if (!client) {
    return { ok: false, error: 'LIVEBLOCKS_SECRET_KEY not set' };
  }

  const liveblocksKind = mapEventKind(event.kind);
  const url = inferDeepLink(event);

  try {
    await client.triggerInboxNotification({
      userId: recipient.userId,
      kind: liveblocksKind,
      subjectId: event.sourceId,
      activityData: {
        title: deriveTitle(event),
        message: deriveMessage(event),
        provider: 'sendero',
        url,
      },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
};

/** Map our event kind to a Liveblocks notification kind.
 *
 *  v1 simplification: all kinds route through `$handoffRequired`
 *  because the @liveblocks/node TypeScript types are pinned to that
 *  literal union (registering custom kinds requires an inbox-types
 *  declaration that's not in v1 scope). The bell still rings; the
 *  inbox UI groups them all together. v2 registers `$bookingConfirmed`
 *  and `$mention` once the dispatcher proves itself. */
function mapEventKind(_eventKind: string): '$handoffRequired' {
  return '$handoffRequired';
}

function inferDeepLink(event: { tripId?: string; data?: Record<string, unknown> }): string {
  if (event.tripId) return `/dashboard/console?tripId=${event.tripId}`;
  if (typeof event.data?.url === 'string') return event.data.url;
  return '/dashboard/console';
}

function deriveTitle(event: { kind: string; data?: Record<string, unknown> }): string {
  if (typeof event.data?.title === 'string') return event.data.title;
  switch (event.kind) {
    case 'handoff.requested':
      return 'Operator handoff requested';
    case 'booking.confirmed':
      return 'Booking confirmed';
    case 'mention.received':
      return 'You were mentioned';
    default:
      return 'Sendero notification';
  }
}

function deriveMessage(event: { data?: Record<string, unknown> }): string {
  if (typeof event.data?.message === 'string') return event.data.message;
  if (typeof event.data?.summary === 'string') return event.data.summary;
  return '';
}
