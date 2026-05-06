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

    // Liveblocks notification fan-out is fire-and-forget — a notify
    // failure must not block the agent's reply path. The operator
    // dashboard list still shows pending rows from the DB, so the
    // notification is purely a real-time nudge.
    void notifyOperatorInbox({
      tenantId,
      handoffId: handoff.id,
      liveblocksRoomId,
      question,
      summary: input.summary ?? null,
    });

    // Slack fan-out — when the tenant has Slack installed, post the
    // handoff request to their `routing.defaultChannel` as an
    // internal-message card. Liveblocks already handles the dashboard
    // inbox notification; this surfaces handoffs to operators living
    // in Slack without forcing a context switch. Best-effort; failures
    // log + drop.
    void notifyOperatorSlack({
      tenantId,
      handoffId: handoff.id,
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

async function notifyOperatorInbox(args: {
  tenantId: string;
  handoffId: string;
  liveblocksRoomId: string;
  question: string;
  summary: string | null;
}): Promise<void> {
  try {
    // Resolve real operator clerk user IDs so the Liveblocks bell in
    // `liveblocks-inbox.tsx` lights up for signed-in admins/finance.
    // The hardcoded `agent:customer-support` user (still emitted) only
    // ever wakes the webhook fanout, never a human's UI.
    let operatorUserIds: string[] = [];
    try {
      const memberships = await prisma.membership.findMany({
        where: {
          tenantId: args.tenantId,
          status: 'active',
          role: { in: ['agency_admin', 'finance'] },
          user: { clerkUserId: { not: null } },
        },
        select: { user: { select: { clerkUserId: true } } },
        take: 50,
      });
      operatorUserIds = memberships
        .map(m => m.user?.clerkUserId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0);
    } catch {
      operatorUserIds = [];
    }
    await notifyOperatorHandoff({
      tenantId: args.tenantId,
      handoffId: args.handoffId,
      liveblocksRoomId: args.liveblocksRoomId,
      title: 'Sendero needs your input',
      message: args.summary ? `${args.question} — ${args.summary}` : args.question,
      url: `/dashboard/handoffs/${args.handoffId}`,
      operatorUserIds,
    });
  } catch (err) {
    console.warn('[handoff] liveblocks notify failed', {
      handoffId: args.handoffId,
      error: err instanceof Error ? err.message : String(err),
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
