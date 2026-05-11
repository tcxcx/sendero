/**
 * Phase C-2 — `NotificationEvent` discriminated union.
 *
 * v1 ships three kinds: `handoff.requested`, `booking.confirmed`,
 * `mention.received`. The `ChannelKind` enum admits `sms` and `push`
 * from v1 even though no adapters exist (codex outside-voice #10):
 * v2 plugs in adapters without a schema migration.
 *
 * `RecipientDescriptor` is the resolution shape — an opaque kind tag
 * plus an id the dispatcher uses to lookup prefs and fan out. The
 * dispatcher does NOT mint Liveblocks user ids or Slack channel ids
 * here; per-channel adapters resolve those at send time.
 */

export type ChannelKind = 'slack' | 'whatsapp' | 'liveblocks_bell' | 'email' | 'sms' | 'push';

export const ALL_CHANNEL_KINDS: ChannelKind[] = [
  'slack',
  'whatsapp',
  'liveblocks_bell',
  'email',
  'sms',
  'push',
];

/** Channels with adapters wired in v1. SMS/push are admitted in the
 *  enum but reject at dispatch time with `status: 'failed'` + a clear
 *  log line. */
export const V1_ADAPTERS: ChannelKind[] = ['slack', 'whatsapp', 'liveblocks_bell', 'email'];

export type EventKind = 'handoff.requested' | 'booking.confirmed' | 'mention.received';

export const ALL_EVENT_KINDS: EventKind[] = [
  'handoff.requested',
  'booking.confirmed',
  'mention.received',
];

/** Default channels per event kind when no per-user pref row exists.
 *  Tenant overrides happen at the dispatcher layer; these are the
 *  fallback when neither user pref nor tenant config is set. */
export const DEFAULT_CHANNELS_BY_EVENT: Record<EventKind, ChannelKind[]> = {
  'handoff.requested': ['liveblocks_bell', 'slack'],
  'booking.confirmed': ['email', 'liveblocks_bell'],
  'mention.received': ['liveblocks_bell', 'slack'],
};

/**
 * Recipient descriptor. The dispatcher resolves channels per recipient
 * via UserNotificationPref + tenant default + event default. Resolution
 * is FRESH per dispatch and snapshotted onto the dispatch row, so
 * mid-flight pref toggles affect only subsequent dispatches.
 */
export interface RecipientDescriptor {
  /** Clerk user id ('user_xxx'). Required for prefs lookup. */
  userId: string;
  /** Display reason for the audit row (e.g., "agency_admin",
   *  "@-mentioned", "trip_owner"). */
  reason?: string;
}

interface BaseEventPayload {
  /** Stable id from the originating call site. Used in dedupKey
   *  (sha256(eventKind + sourceId + recipientId + channelKind)) so
   *  retrofitted direct-call paths AND the dispatcher converge on
   *  the same key. */
  sourceId: string;
  /** Provenance — 'agent_tool', 'webhook', 'workflow', 'manual'. */
  sourceKind: 'agent_tool' | 'webhook' | 'workflow' | 'manual';
  /** Trip association for trip-scoped events. Optional because some
   *  notifications (workspace-wide ops alerts) aren't trip-scoped. */
  tripId?: string;
  /** Free-form payload the channel adapters use to build the actual
   *  message body. Kept JSON-serializable so it lands cleanly in the
   *  dispatch row's recipients/snapshot fields. */
  data: Record<string, unknown>;
}

export interface HandoffRequestedEvent extends BaseEventPayload {
  kind: 'handoff.requested';
  /** Sendero handoff id (`ChannelHandoff.id`). Stable; safe to use as
   *  dedup source. */
  sourceId: string;
}

export interface BookingConfirmedEvent extends BaseEventPayload {
  kind: 'booking.confirmed';
  /** Booking id (`Booking.id`). */
  sourceId: string;
}

export interface MentionReceivedEvent extends BaseEventPayload {
  kind: 'mention.received';
  /** Liveblocks thread id (or comment id when finer-grained). The
   *  liveblocks-webhook-fanout call site supplies this from the
   *  webhook payload. */
  sourceId: string;
}

export type NotificationEvent =
  | HandoffRequestedEvent
  | BookingConfirmedEvent
  | MentionReceivedEvent;

/**
 * Build the dedup key the dispatcher AND retrofitted call sites both
 * compute. Keep this stable across surfaces — drift between the two
 * means the UNIQUE constraint won't fire and recipients see double
 * notifications during the migration cutover.
 *
 * Hash inputs:
 *   - `eventKind` — namespace (so `handoff.requested:foo` !=
 *     `booking.confirmed:foo`)
 *   - `sourceId`  — the originating row id
 *   - `recipientId` — the Clerk user id (or 'tenant' for tenant-wide)
 *   - `channelKind` — `slack` | `whatsapp` | etc, so the same event
 *     can hit multiple channels for the same recipient without
 *     deduping each other out
 */
export function computeDedupKey(
  eventKind: EventKind,
  sourceId: string,
  recipientId: string,
  channelKind: ChannelKind
): string {
  // Deferred import to avoid pulling node:crypto into bundlers that
  // dead-code-eliminate it.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHash } = require('node:crypto') as typeof import('node:crypto');
  return createHash('sha256')
    .update(`${eventKind}|${sourceId}|${recipientId}|${channelKind}`)
    .digest('hex');
}
