/**
 * `request_human_handoff` — agent-callable escalation tool.
 *
 * Mirrors the Kapso support-agent example's `ask_team_question` but
 * terminates in Sendero's own operator surfaces (MetaInbox, trip inbox,
 * Liveblocks inbox notification on `agent:customer-support`). Use when
 * the agent is uncertain enough that a wrong answer would burn
 * traveler trust — pricing edge cases, policy ambiguities, refund
 * exceptions, anything off-script.
 *
 * Lifecycle:
 *   1. Agent calls `request_human_handoff({ question, summary? })`.
 *   2. Tool persists a `ChannelHandoff` row, writes a `handoff_requested`
 *      event onto the trip ledger (so MetaInbox + trip inbox surface
 *      it inline), and triggers a Liveblocks inbox notification on the
 *      tenant's support-agent room.
 *   3. Tool returns `{ handoffId, status: 'queued' }`. The agent's
 *      next message to the customer should acknowledge the wait, e.g.
 *      "let me check with the team — I'll be right back".
 *   4. Operator answers in `/dashboard/handoffs/<id>` or directly in
 *      MetaInbox. The resolve route formats + delivers the answer to
 *      the originating channel.
 */

import { type Prisma, prisma } from '@sendero/database';
import { notifyOperatorHandoff, roomIdForSupportCase } from '@sendero/collaboration/server';
import { claimDispatchSlot } from '@sendero/notifications/dedup-slot';
import { dispatch } from '@sendero/notifications/dispatch';
import { notifyTerminalFallback } from '@sendero/notifications/fallback-chain';
import { z } from 'zod';

import type { ToolDef, ToolContext } from './types';

/**
 * Schema accepts either `question` (canonical) or `reason` (alias the
 * agent sometimes synthesizes from natural-language framing). Coerced
 * to `question` in the handler. The persona explicitly tells the agent
 * to use `question`; the alias is defense-in-depth for prompt drift.
 */
const requestHumanHandoffInput = z
  .object({
    question: z
      .string()
      .min(5)
      .max(2000)
      .optional()
      .describe(
        "The exact question Sendero needs the operator team to answer. Phrase it so an operator who hasn't seen this thread can respond directly."
      ),
    reason: z
      .string()
      .min(5)
      .max(2000)
      .optional()
      .describe('Alias of `question`. Provide one or the other — never both.'),
    summary: z
      .string()
      .max(2000)
      .optional()
      .describe(
        'Optional 1-3 sentence customer/context summary so the operator can answer quickly without reading the full thread.'
      ),
    /** Optional active trip — when present, the handoff is anchored to that trip
     *  and the trip inbox surfaces it. Falls back to tool context when omitted. */
    tripId: z.string().min(1).optional(),
  })
  .refine(v => Boolean(v.question || v.reason), {
    message:
      'request_human_handoff requires `question` (or `reason`) describing what to ask the team.',
  });

interface RequestHumanHandoffOutput {
  handoffId: string;
  status: 'queued';
  liveblocksRoomId: string;
  /** Customer-facing acknowledgement the agent should relay verbatim
   *  unless it has a more locale-appropriate phrasing in voice. */
  acknowledgement: string;
}

export const requestHumanHandoffTool: ToolDef<
  z.infer<typeof requestHumanHandoffInput>,
  RequestHumanHandoffOutput
> = {
  name: 'request_human_handoff',
  internal: true,
  description:
    'Escalate the current conversation to a human operator on the tenant team. Use when uncertain enough that a wrong answer would damage traveler trust (pricing edge cases, policy ambiguities, refund exceptions, anything off-script). Persists a handoff record, notifies the operator dashboard via Liveblocks, and returns a customer-facing acknowledgement so the agent can tell the traveler the team is checking. The operator answers in Sendero; the answer is delivered to the originating channel.',
  inputSchema: requestHumanHandoffInput,
  jsonSchema: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        minLength: 5,
        maxLength: 2000,
        description:
          "The exact question for the operator team. Phrase it so an operator who hasn't seen this thread can respond directly.",
      },
      reason: {
        type: 'string',
        minLength: 5,
        maxLength: 2000,
        description: 'Alias of `question`. Provide one or the other — never both.',
      },
      summary: {
        type: 'string',
        maxLength: 2000,
        description: 'Optional 1-3 sentence customer/context summary.',
      },
      tripId: { type: 'string', description: 'Optional active trip id.' },
    },
  },
  async handler(input, ctx) {
    const tenantId = ctx?.traveler?.tenantId;
    if (!tenantId) throw new Error('handoff_missing_tenant_context');

    // Coerce `reason` → `question` so prompt drift doesn't 500. The
    // refine() above guarantees at least one is present.
    const question = (input.question ?? input.reason ?? '').trim();
    if (!question) throw new Error('handoff_missing_question');

    const channelIdentity = await resolveChannelIdentity(tenantId, ctx);
    if (!channelIdentity) throw new Error('handoff_missing_channel_identity');

    const tripId = input.tripId ?? (await resolveActiveTripId(tenantId, channelIdentity.id));

    const handoff = await prisma.channelHandoff.create({
      data: {
        tenantId,
        tripId: tripId ?? null,
        channelIdentityId: channelIdentity.id,
        channel: channelIdentity.kind,
        question,
        summary: input.summary ?? null,
        liveblocksRoomId: 'pending',
      },
      select: { id: true },
    });

    const liveblocksRoomId = roomIdForSupportCase(tenantId, handoff.id);

    await prisma.channelHandoff.update({
      where: { id: handoff.id },
      data: { liveblocksRoomId },
    });

    if (tripId) {
      await appendTripHandoffEvent({
        tenantId,
        tripId,
        kind: 'handoff_requested',
        handoffId: handoff.id,
        question,
        summary: input.summary ?? null,
        channel: channelIdentity.kind,
      });
    }

    // Phase C-2 strict-dedup-alignment fanout (locked /plan-eng-review E5).
    //
    // 1. Resolve operator Clerk user ids ONCE — both legacy and dispatcher
    //    target the same recipient set, so they share resolution.
    // 2. Per operator, try-claim the `liveblocks_bell` dedup row. First
    //    inserter wins — legacy fires bell ONLY for operators whose
    //    slots it claimed. The parallel dispatcher will P2002 across the
    //    same set and skip its bell calls.
    // 3. Fire legacy default-channel Slack post (additive — tenant-wide
    //    broadcast has no per-operator dedup analogue; commit 2 deletes
    //    it once dispatcher's per-operator DMs prove out).
    // 4. Fire `dispatch()` in parallel; its slack adapter does per-
    //    operator DMs via `SlackUserBinding` (new behavior, doesn't
    //    overlap legacy default-channel post).
    // 5. On total sentCount === 0 → terminal fallback to Sendero ops
    //    Slack (codex outside-voice #5; locked /plan-eng-review E7).
    //
    // All work is fire-and-forget — the agent's traveler-facing reply
    // must never block on operator notification fan-out.
    void runHandoffNotifications({
      tenantId,
      handoffId: handoff.id,
      liveblocksRoomId,
      question,
      summary: input.summary ?? null,
      channel: channelIdentity.kind,
      tripId: tripId ?? null,
    });

    return {
      handoffId: handoff.id,
      status: 'queued' as const,
      liveblocksRoomId,
      acknowledgement: "Let me check with the team — I'll be right back.",
    };
  },
};

async function resolveChannelIdentity(
  tenantId: string,
  ctx: ToolContext | undefined
): Promise<{ id: string; kind: string } | null> {
  // Prefer an explicit identity hint in tool context (set by the
  // dispatch route). Fall back to a phone lookup so the tool works
  // when invoked from the agent-chat test bench too.
  const explicit = ctx?.channelIdentityId;
  if (explicit) {
    const row = await prisma.channelIdentity.findUnique({
      where: { id: explicit },
      select: { id: true, tenantId: true, kind: true },
    });
    if (row && row.tenantId === tenantId) return { id: row.id, kind: row.kind };
  }
  const phone = ctx?.traveler?.phone;
  if (phone) {
    const row = await prisma.channelIdentity.findFirst({
      where: { tenantId, externalUserId: phone },
      select: { id: true, kind: true },
    });
    if (row) return row;
  }
  return null;
}

async function resolveActiveTripId(
  tenantId: string,
  channelIdentityId: string
): Promise<string | null> {
  const identity = await prisma.channelIdentity.findUnique({
    where: { id: channelIdentityId },
    select: { userId: true },
  });
  if (!identity?.userId) return null;
  const trip = await prisma.trip.findFirst({
    where: {
      tenantId,
      travelerId: identity.userId,
      status: { in: ['draft', 'searching', 'awaiting_approval', 'booked', 'in_progress'] },
    },
    orderBy: { updatedAt: 'desc' },
    select: { id: true },
  });
  return trip?.id ?? null;
}

async function appendTripHandoffEvent(args: {
  tenantId: string;
  tripId: string;
  kind: 'handoff_requested' | 'handoff_answered' | 'handoff_closed';
  handoffId: string;
  question?: string;
  summary?: string | null;
  answer?: string;
  channel: string;
  answeredByUserId?: string;
}): Promise<void> {
  const entry: Prisma.InputJsonObject = {
    id: `ho_${args.handoffId}_${args.kind}`,
    kind: args.kind,
    handoffId: args.handoffId,
    channel: args.channel,
    createdAt: new Date().toISOString(),
    direction: 'internal',
    ...(args.question ? { question: args.question } : {}),
    ...(args.summary ? { summary: args.summary } : {}),
    ...(args.answer ? { text: args.answer } : {}),
    ...(args.answeredByUserId ? { answeredByUserId: args.answeredByUserId } : {}),
  };
  await prisma.$executeRaw`
    UPDATE trips
       SET events = COALESCE(events, '[]'::jsonb) || ${entry as unknown as Prisma.JsonValue}::jsonb
     WHERE id = ${args.tripId} AND "tenantId" = ${args.tenantId}
  `;
}

/**
 * Resolve the Clerk user ids for the tenant's operator team
 * (agency_admin + finance). Used by both legacy bell fanout AND the
 * dispatcher — sharing resolution keeps the dedup keys aligned because
 * both code paths target the same recipient set.
 */
async function resolveOperatorClerkUserIds(tenantId: string): Promise<string[]> {
  try {
    const memberships = await prisma.membership.findMany({
      where: {
        tenantId,
        status: 'active',
        role: { in: ['agency_admin', 'finance'] },
        user: { clerkUserId: { not: null } },
      },
      select: { user: { select: { clerkUserId: true } } },
      take: 50,
    });
    return memberships
      .map(m => m.user?.clerkUserId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
  } catch {
    return [];
  }
}

/**
 * Phase C-2 fanout orchestrator. See call-site comment for the
 * five-step contract. Returns nothing — fully fire-and-forget; failures
 * log + drop.
 */
async function runHandoffNotifications(args: {
  tenantId: string;
  handoffId: string;
  liveblocksRoomId: string;
  question: string;
  summary: string | null;
  channel: string;
  tripId: string | null;
}): Promise<void> {
  const operatorUserIds = await resolveOperatorClerkUserIds(args.tenantId);

  // Per-operator dedup claim for the bell channel. Legacy fires bell
  // ONLY for operators whose slot it won — when the dispatcher (called
  // below) gets there first, those operators bell from the dispatcher's
  // adapter instead.
  const claimedBellOperators: string[] = [];
  for (const userId of operatorUserIds) {
    const claim = await claimDispatchSlot({
      tenantId: args.tenantId,
      eventKind: 'handoff.requested',
      sourceKind: 'agent_tool',
      sourceId: args.handoffId,
      recipientUserId: userId,
      recipientReason: 'agency_admin/finance',
      channelKind: 'liveblocks_bell',
      triggeredBy: 'legacy:request_human_handoff',
    });
    if (claim.claimed) claimedBellOperators.push(userId);
  }

  // Fire legacy paths + dispatcher in parallel. Each is independently
  // fail-soft. Use Promise.allSettled so a slow Slack post can't delay
  // a fast bell, and a failed dispatcher can't break the legacy bell.
  const dispatchPromise = dispatch({
    event: {
      kind: 'handoff.requested',
      sourceId: args.handoffId,
      sourceKind: 'agent_tool',
      tripId: args.tripId ?? undefined,
      data: {
        title: 'Sendero needs your input',
        message: args.summary ? `${args.question} — ${args.summary}` : args.question,
        question: args.question,
        summary: args.summary,
        channel: args.channel,
        url: `/dashboard/handoffs/${args.handoffId}`,
      },
    },
    recipients: operatorUserIds.map(userId => ({
      userId,
      reason: 'agency_admin/finance',
    })),
    context: {
      tenantId: args.tenantId,
      triggeredBy: 'request_human_handoff',
    },
  }).catch(err => {
    console.warn('[handoff] dispatcher failed', {
      handoffId: args.handoffId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  });

  const legacyBellPromise = notifyOperatorHandoff({
    tenantId: args.tenantId,
    handoffId: args.handoffId,
    liveblocksRoomId: args.liveblocksRoomId,
    title: 'Sendero needs your input',
    message: args.summary ? `${args.question} — ${args.summary}` : args.question,
    url: `/dashboard/handoffs/${args.handoffId}`,
    operatorUserIds: claimedBellOperators,
  }).catch(err => {
    console.warn('[handoff] liveblocks notify failed', {
      handoffId: args.handoffId,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  const legacySlackPromise = notifyOperatorSlack({
    tenantId: args.tenantId,
    handoffId: args.handoffId,
    question: args.question,
    summary: args.summary,
    channel: args.channel,
    tripId: args.tripId,
  });

  const [, , dispatchResult] = await Promise.all([
    legacyBellPromise,
    legacySlackPromise,
    dispatchPromise,
  ]);

  // Terminal-fallback chain — fires when no recipient got any
  // notification. Reasons covered:
  //   - 0 operators bound (operatorUserIds empty)
  //   - all dispatcher channels failed AND legacy bell got 0 claimed ops
  // Throttled 1-per-30-min per (tenantId, eventKind) inside notifyTerminalFallback.
  const dispatcherSent = dispatchResult?.sentCount ?? 0;
  const legacyBellSent = claimedBellOperators.length;
  if (dispatcherSent === 0 && legacyBellSent === 0) {
    await notifyTerminalFallback({
      tenantId: args.tenantId,
      eventKind: 'handoff.requested',
      sourceId: args.handoffId,
      reason:
        operatorUserIds.length === 0
          ? '0 operators bound to tenant'
          : 'all dispatch channels failed and no legacy bells claimed',
      url: `/dashboard/handoffs/${args.handoffId}`,
    });
  }
}

/**
 * Slack fan-out for handoff requests. Posts a Block Kit "internal
 * message" card to the tenant's `routing.defaultChannel`. The card
 * approximates the Liveblocks inbox notification's content so an
 * operator who lives in Slack sees the same payload they would in
 * the web dashboard.
 *
 * No-op when the tenant has no SlackInstall, no defaultChannel
 * configured, or the install is revoked. Best-effort throughout — a
 * Slack outage must never block the agent's traveler-facing reply.
 */
async function notifyOperatorSlack(args: {
  tenantId: string;
  handoffId: string;
  question: string;
  summary: string | null;
  channel: string;
  tripId: string | null;
}): Promise<void> {
  try {
    const install = await prisma.slackInstall.findFirst({
      where: { tenantId: args.tenantId, revokedAt: null },
      select: { botToken: true, routing: true },
    });
    if (!install?.botToken) return;

    const routing = (install.routing ?? {}) as Record<string, unknown>;
    const defaultChannel =
      typeof routing.defaultChannel === 'string' ? routing.defaultChannel : null;
    if (!defaultChannel) return;

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3010';
    const handoffUrl = `${baseUrl.replace(/\/$/, '')}/dashboard/handoffs/${args.handoffId}`;

    // Lazy-import to avoid bundling Slack SDK into edge surfaces that
    // never use it (every consumer of @sendero/tools).
    const { createSlackClient, sendBlocks } = await import('@sendero/slack');
    const client = createSlackClient(install.botToken);

    await sendBlocks({
      client,
      channel: defaultChannel,
      text: `Sendero handoff: ${args.question}`,
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: '🛎  Sendero needs your input' },
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `*Question*\n${args.question}` },
        },
        ...(args.summary
          ? [
              {
                type: 'section' as const,
                text: { type: 'mrkdwn' as const, text: `*Context*\n${args.summary}` },
              },
            ]
          : []),
        {
          type: 'context',
          elements: [
            { type: 'mrkdwn', text: `Channel: \`${args.channel}\`` },
            ...(args.tripId ? [{ type: 'mrkdwn' as const, text: `Trip: \`${args.tripId}\`` }] : []),
            { type: 'mrkdwn', text: `Handoff: \`${args.handoffId}\`` },
          ],
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Answer in Sendero' },
              url: handoffUrl,
              style: 'primary',
            },
          ],
        },
      ],
    });
  } catch (err) {
    console.warn('[handoff] slack fanout failed', {
      handoffId: args.handoffId,
      tenantId: args.tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export { appendTripHandoffEvent };
