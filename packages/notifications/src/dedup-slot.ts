/**
 * Phase C-2 — strict dedup-alignment helper.
 *
 * Both `dispatch()` and retrofitted legacy paths call this to claim a
 * `NotificationDispatch` row before performing their actual send. First
 * to insert wins and proceeds; second hits the UNIQUE constraint on
 * `(tenantId, dedupKey, channelKind)`, gets P2002 back, and MUST skip.
 *
 * Sharing the helper across both code paths is load-bearing: divergent
 * `computeDedupKey()` arguments would yield different keys, the UNIQUE
 * constraint would never fire, and recipients would see double
 * notifications during the migration cutover. /plan-eng-review E5.
 */
import { Prisma, prisma } from '@sendero/database';

import { type ChannelKind, type EventKind, computeDedupKey } from './event-kinds';

export interface ClaimSlotArgs {
  tenantId: string;
  eventKind: EventKind;
  sourceKind: 'agent_tool' | 'webhook' | 'workflow' | 'manual';
  sourceId: string;
  recipientUserId: string;
  recipientReason?: string;
  channelKind: ChannelKind;
  /** Audit label — `'legacy:<retrofit-name>'` for retrofit sites,
   *  `'system'` / `'user_xxx'` / `'webhook:duffel'` for dispatcher
   *  call sites. Surfaces in `NotificationDispatch.triggeredBy`. */
  triggeredBy: string;
  /** Channels-resolution snapshot for audit. Optional — retrofit sites
   *  skip this since they pre-decided the channel. */
  snapshotPrefs?: Prisma.InputJsonValue;
}

export interface ClaimSlotResult {
  /** True when this caller inserted the row and SHOULD proceed with the
   *  actual send. False when the row already existed (P2002) — caller
   *  MUST skip its send. */
  claimed: boolean;
  dedupKey: string;
  /** Set when `claimed=true` but the INSERT itself errored for a
   *  non-dedup reason (transient DB hiccup). Caller should still
   *  proceed — fail-soft on infra wobbles to keep the agent reply
   *  path unblocked. */
  error?: string;
}

/**
 * Try INSERT a `NotificationDispatch` row keyed on the strict dedupKey.
 *
 * - First inserter: returns `{ claimed: true }`; caller sends.
 * - P2002 (row exists): returns `{ claimed: false }`; caller skips.
 * - Other DB error: returns `{ claimed: true, error }`; caller still
 *   sends (better double-fire than silent drop on infra wobble).
 */
export async function claimDispatchSlot(args: ClaimSlotArgs): Promise<ClaimSlotResult> {
  const dedupKey = computeDedupKey(
    args.eventKind,
    args.sourceId,
    args.recipientUserId,
    args.channelKind
  );
  try {
    await prisma.notificationDispatch.create({
      data: {
        tenantId: args.tenantId,
        sourceKind: args.sourceKind,
        sourceId: args.sourceId,
        eventKind: args.eventKind,
        dedupKey,
        channelKind: args.channelKind,
        recipients: [{ userId: args.recipientUserId, reason: args.recipientReason ?? null }],
        snapshotPrefs: args.snapshotPrefs ?? ({} as Prisma.InputJsonValue),
        status: 'sent',
        triggeredBy: args.triggeredBy,
      },
    });
    return { claimed: true, dedupKey };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { claimed: false, dedupKey };
    }
    return {
      claimed: true,
      dedupKey,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Mark an existing dispatch row as `failed` after a send error. The
 * caller already has the dedupKey from `claimDispatchSlot`. Update is
 * best-effort — the row is the audit record, not the delivery
 * authority.
 */
export async function markDispatchFailed(
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
    // Row may not exist (claim itself failed pre-INSERT). Swallow.
  }
}
