/**
 * Phase C-2 — cross-channel notification dispatcher.
 *
 *   ┌─────────────────────────────────────────────────────────────────┐
 *   │  Application call site (tool / webhook / workflow / manual)     │
 *   │                                                                 │
 *   │   await dispatch({                                              │
 *   │     event: { kind: 'handoff.requested', sourceId, sourceKind,   │
 *   │              tripId, data },                                    │
 *   │     recipients: [{ userId, reason }],                           │
 *   │     context: { tenantId, triggeredBy }                          │
 *   │   })                                                            │
 *   └────────────────┬────────────────────────────────────────────────┘
 *                    │
 *                    ▼
 *   ┌─────────────────────────────────────────────────────────────────┐
 *   │  dispatch(...)                                                  │
 *   │  ─────────────────────────────────────────────────────────────  │
 *   │  1. Resolve channels per recipient via UserNotificationPref +   │
 *   │     tenant default + DEFAULT_CHANNELS_BY_EVENT                  │
 *   │  2. Snapshot prefs onto the dispatch row                        │
 *   │  3. For each (recipient, channelKind):                          │
 *   │     a. computeDedupKey                                          │
 *   │     b. INSERT NotificationDispatch row with UNIQUE on            │
 *   │        (tenantId, dedupKey, channelKind)                        │
 *   │     c. P2002 (unique violation) → status='skipped_dupe'         │
 *   │     d. New row → call channel adapter; update status from       │
 *   │        adapter result                                           │
 *   │  4. Return DispatchResult[] for caller telemetry                │
 *   └─────────────────────────────────────────────────────────────────┘
 *
 * Migration cutover semantics: legacy direct-call sites compute the
 * SAME dedupKey via `computeDedupKey()` from event-kinds.ts. When
 * both fire during the parallel-fire window, the second insert hits
 * P2002 and the dispatcher records `skipped_dupe` instead of double-
 * sending. Locked /plan-eng-review E5.
 *
 * Per-channel audit (WhatsAppOutboundMessage, MeterEvent, Trip.events)
 * stays in existing tables — codex outside-voice #2. The
 * `NotificationDispatch` row is a correlation envelope only.
 */

import { Prisma, prisma } from '@sendero/database';
import {
  type ChannelKind,
  computeDedupKey,
  DEFAULT_CHANNELS_BY_EVENT,
  type EventKind,
  type NotificationEvent,
  type RecipientDescriptor,
  V1_ADAPTERS,
} from '@sendero/notifications/event-kinds';

export interface DispatchContext {
  /** Tenant id — fails closed if absent (Responsible AI ship gate). */
  tenantId: string;
  /** Audit trail: 'user_xxx' | 'system' | 'webhook:duffel' | 'workflow:run-id'. */
  triggeredBy: string;
}

export interface DispatchInput {
  event: NotificationEvent;
  recipients: RecipientDescriptor[];
  context: DispatchContext;
}

export interface DispatchAttempt {
  recipientUserId: string;
  channelKind: ChannelKind;
  dedupKey: string;
  status: 'sent' | 'skipped_dupe' | 'skipped_pref' | 'failed' | 'no_adapter';
  error?: string;
}

export interface DispatchResult {
  attempts: DispatchAttempt[];
  /** Count of attempts where status === 'sent'. Useful for fallback-
   *  chain triggers (e.g., handoff with 0 sent → fallback). */
  sentCount: number;
  /** True iff `recipients.length === 0` at the call site. Used by
   *  the Liveblocks identity gate / fallback chain in `fallback-chain.ts`. */
  noRecipients: boolean;
}

/** Channel adapter contract. Each adapter takes the event + recipient
 *  and returns success/failure. Adapters are imported lazily in
 *  `runAdapter()` so dev/testing builds don't require every channel's
 *  env vars set. */
export type ChannelAdapter = (args: {
  event: NotificationEvent;
  recipient: RecipientDescriptor;
  context: DispatchContext;
}) => Promise<{ ok: boolean; error?: string }>;

/**
 * Main entry point.
 */
export async function dispatch(input: DispatchInput): Promise<DispatchResult> {
  const { event, recipients, context } = input;

  if (!context.tenantId) {
    throw new Error('[dispatch] tenantId is required (Responsible AI ship gate)');
  }

  if (recipients.length === 0) {
    return { attempts: [], sentCount: 0, noRecipients: true };
  }

  const attempts: DispatchAttempt[] = [];

  for (const recipient of recipients) {
    const channels = await resolveChannels(event.kind, recipient.userId, context.tenantId);
    const snapshotPrefs = { eventKind: event.kind, channels, resolvedAt: new Date().toISOString() };

    for (const channelKind of channels) {
      const dedupKey = computeDedupKey(event.kind, event.sourceId, recipient.userId, channelKind);

      const attempt: DispatchAttempt = {
        recipientUserId: recipient.userId,
        channelKind,
        dedupKey,
        status: 'sent',
      };

      try {
        await prisma.notificationDispatch.create({
          data: {
            tenantId: context.tenantId,
            sourceKind: event.sourceKind,
            sourceId: event.sourceId,
            eventKind: event.kind,
            dedupKey,
            channelKind,
            recipients: [{ userId: recipient.userId, reason: recipient.reason ?? null }],
            snapshotPrefs,
            status: 'sent',
            triggeredBy: context.triggeredBy,
          },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          attempt.status = 'skipped_dupe';
          attempts.push(attempt);
          continue;
        }
        attempt.status = 'failed';
        attempt.error = err instanceof Error ? err.message : String(err);
        attempts.push(attempt);
        continue;
      }

      // Channel adapter dispatch. Failures update the dispatch row's
      // status from 'sent' → 'failed' so the audit reflects reality.
      if (!V1_ADAPTERS.includes(channelKind)) {
        attempt.status = 'no_adapter';
        attempt.error = `no adapter wired for ${channelKind} in v1`;
        await markDispatchFailed(context.tenantId, dedupKey, channelKind, attempt.error);
        attempts.push(attempt);
        continue;
      }

      const result = await runAdapter(channelKind, { event, recipient, context });
      if (!result.ok) {
        attempt.status = 'failed';
        attempt.error = result.error ?? 'adapter returned ok=false';
        await markDispatchFailed(context.tenantId, dedupKey, channelKind, attempt.error);
      }
      attempts.push(attempt);
    }
  }

  const sentCount = attempts.filter(a => a.status === 'sent').length;
  return { attempts, sentCount, noRecipients: false };
}

/**
 * Resolve the channels for a (recipient, eventKind) tuple. Order of
 * precedence per /plan-eng-review E4:
 *   1. UserNotificationPref row → use its channels
 *   2. Tenant default (deferred to v2 — flag in Tenant.metadata)
 *   3. DEFAULT_CHANNELS_BY_EVENT
 */
async function resolveChannels(
  eventKind: EventKind,
  userId: string,
  tenantId: string
): Promise<ChannelKind[]> {
  const pref = await prisma.userNotificationPref.findUnique({
    where: { userId_tenantId_eventKind: { userId, tenantId, eventKind } },
    select: { channels: true },
  });
  if (pref) return pref.channels as ChannelKind[];
  return DEFAULT_CHANNELS_BY_EVENT[eventKind];
}

async function markDispatchFailed(
  tenantId: string,
  dedupKey: string,
  channelKind: ChannelKind,
  error: string
): Promise<void> {
  try {
    await prisma.notificationDispatch.update({
      where: { tenantId_dedupKey_channelKind: { tenantId, dedupKey, channelKind } },
      data: { status: 'failed' },
    });
  } catch {
    // The row may not exist yet (race on adapter failure before insert
    // commits). Swallow — the failure is already in the attempts array
    // and the caller logs.
  }
  console.warn('[dispatch] adapter failed', {
    tenantId,
    channelKind,
    dedupKey: dedupKey.slice(0, 8),
    error,
  });
}

async function runAdapter(
  channelKind: ChannelKind,
  args: {
    event: NotificationEvent;
    recipient: RecipientDescriptor;
    context: DispatchContext;
  }
): Promise<{ ok: boolean; error?: string }> {
  // Lazy import. Each adapter is server-only and imports its own
  // provider sdk; we don't want chat-col bundling Slack secrets.
  switch (channelKind) {
    case 'slack': {
      const { slackAdapter } = await import('./adapters/slack');
      return slackAdapter(args);
    }
    case 'whatsapp': {
      const { whatsappAdapter } = await import('./adapters/whatsapp');
      return whatsappAdapter(args);
    }
    case 'liveblocks_bell': {
      const { liveblocksBellAdapter } = await import('./adapters/liveblocks-bell');
      return liveblocksBellAdapter(args);
    }
    case 'email': {
      const { emailAdapter } = await import('./adapters/email');
      return emailAdapter(args);
    }
    default:
      return { ok: false, error: `unsupported channel: ${channelKind}` };
  }
}
