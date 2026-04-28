/**
 * Trip events — canonical write primitive for the unified inbox ledger.
 *
 * `Trip.events` is a `Json` column with append-only semantics. Every
 * channel handler (operator reply, agent turn, traveler inbound, tool
 * call) appends an event entry; `loadConsoleData` reads the column,
 * maps it into `UnifiedMessage[]`, and the console / trip inbox renders
 * a single chronological thread across WhatsApp, Slack, web, internal.
 *
 * Atomic Postgres `||` jsonb append. Concurrent-safe: no read-then-
 * write race that could lose events. Tenant double-bound in the WHERE
 * clause so a TOCTOU can't write across tenants.
 *
 * Shape mirrors the slack-views/trip-note pattern from CLAUDE.md:
 *
 *   UPDATE "trips"
 *   SET events = COALESCE(events, '[]'::jsonb) || $1::jsonb
 *   WHERE id = $2 AND "tenantId" = $3;
 *
 * Returns `true` when exactly one row was updated, `false` otherwise
 * (unknown trip, cross-tenant, DB error). Callers should log on false
 * but rarely surface to the user — it's an audit-trail write, not a
 * primary action. The agent reply already went out; this is just the
 * ledger entry.
 */

import { prisma } from '@sendero/database';

/**
 * Canonical Trip event shape. Every appended event must conform.
 *
 * Required:
 *   - `id` — stable per-source identifier (e.g., wamid for WhatsApp,
 *     event_id for Slack, generated for operator replies). Used by
 *     UnifiedMessage rendering for stable React keys.
 *   - `kind` — discriminator. The console-data mapper switches on this.
 *   - `direction` — inbound (traveler → us) | outbound (us → traveler)
 *     | internal (operator ↔ Sendero AI, never visible to traveler).
 *   - `channel` — the channel this event happened on.
 *   - `createdAt` — ISO8601 string. Used to sort across channels.
 *
 * Common optional payloads (subset rendered per kind):
 *   - `text` — message body
 *   - `author` — who sent it (kind, displayName, slackUserId, etc.)
 *   - `toolName` / `toolArgs` / `priceMicroUsdc` — for `kind: 'tool_call'`
 *   - `status` — delivery state (pending / sent / delivered / read / failed)
 *   - any extra fields per kind; the column is a Json blob, schema is
 *     enforced here at the write site, not in Postgres.
 */
export interface TripEvent {
  id: string;
  kind:
    | 'inbox_reply'
    | 'agent_reply'
    | 'agent_turn'
    | 'tool_call'
    | 'tool_result'
    | 'operator_note'
    | 'system_note';
  direction: 'inbound' | 'outbound' | 'internal';
  channel: 'whatsapp' | 'slack' | 'sms' | 'email' | 'web' | 'internal';
  createdAt: string;
  text?: string;
  author?: {
    kind: 'traveler' | 'operator' | 'agent' | 'system';
    displayName?: string;
    slackUserId?: string;
    waId?: string;
    userId?: string;
  };
  toolName?: string;
  toolArgs?: string;
  priceMicroUsdc?: string;
  status?: 'pending' | 'sent' | 'delivered' | 'read' | 'failed' | 'internal';
  // Forward-compatible bag for fields not yet typed.
  [key: string]: unknown;
}

export interface AppendTripEventArgs {
  tripId: string;
  tenantId: string;
  event: TripEvent;
}

/**
 * Append one event to `Trip.events` atomically. Returns true on success,
 * false on tenant mismatch, unknown trip, or DB error.
 *
 * Use from channel handlers (WhatsApp inbound webhook, Slack events
 * route, agent dispatch, operator reply). Don't read-then-write — that's
 * a race; the JSONB || operator is the canonical primitive.
 */
export async function appendTripEvent({
  tripId,
  tenantId,
  event,
}: AppendTripEventArgs): Promise<boolean> {
  if (!tripId || !tenantId || !event?.id || !event?.kind) return false;
  const payload = JSON.stringify([event]);
  try {
    const rows = await prisma.$executeRaw`
      UPDATE "trips"
      SET events = COALESCE(events, '[]'::jsonb) || ${payload}::jsonb
      WHERE id = ${tripId} AND "tenantId" = ${tenantId}
    `;
    return rows === 1;
  } catch (err) {
    console.warn('[trip-events] append failed', {
      tripId,
      kind: event.kind,
      direction: event.direction,
      channel: event.channel,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Generate a stable, sortable id for events that don't carry a natural
 * one (operator-composed messages, system notes). Format: `evt_<base36
 * timestamp>_<random8>`. Use `wamid` for WhatsApp, `event_id` for Slack
 * — those are authoritative dedup keys.
 */
export function newTripEventId(prefix = 'evt'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Resolve the most-recent active trip for a channel identity, scoped to
 * the tenant. Used by channel webhooks (WhatsApp inbound, Slack inbound)
 * to figure out which Trip ledger an inbound traveler message belongs
 * to. Returns null when the traveler has no in-flight trip — the caller
 * skips the ledger write but still dispatches the agent turn (the agent
 * may create a trip via tool calls, future messages will land then).
 *
 * Performance notes:
 *   - Two-hop join (ChannelIdentity → Traveler → Trip), bounded by
 *     `take: 1` and `orderBy: updatedAt desc`. With the existing
 *     `Trip.tenantId,updatedAt` index this is sub-ms in practice.
 *   - Excludes terminal-state trips (`completed`, `canceled`, `failed`)
 *     so a stale trip can't capture new inbound messages.
 *   - Caller can cache the result for the duration of one webhook
 *     delivery; we don't cache here because the helper is cheap and
 *     each delivery is a fresh request.
 */
export async function resolveActiveTripForChannelIdentity(args: {
  tenantId: string;
  channelIdentityId: string;
}): Promise<string | null> {
  const { tenantId, channelIdentityId } = args;
  if (!tenantId || !channelIdentityId) return null;
  const trip = await prisma.trip.findFirst({
    where: {
      tenantId,
      status: { notIn: ['completed', 'canceled', 'failed'] },
      traveler: {
        channelIdentities: { some: { id: channelIdentityId } },
      },
    },
    orderBy: { updatedAt: 'desc' },
    select: { id: true },
  });
  return trip?.id ?? null;
}

/**
 * Resolve the most-recent active trip for a Sendero `User.id` directly.
 * Used by the Slack agent flow, where the slack-user-mapping module has
 * already resolved the inbound slack user to a `User.id` and we don't
 * need the indirection through `ChannelIdentity`. Same skip-when-null
 * contract as the channel-identity variant.
 */
export async function resolveActiveTripForUser(args: {
  tenantId: string;
  userId: string;
}): Promise<string | null> {
  const { tenantId, userId } = args;
  if (!tenantId || !userId) return null;
  const trip = await prisma.trip.findFirst({
    where: {
      tenantId,
      travelerId: userId,
      status: { notIn: ['completed', 'canceled', 'failed'] },
    },
    orderBy: { updatedAt: 'desc' },
    select: { id: true },
  });
  return trip?.id ?? null;
}
