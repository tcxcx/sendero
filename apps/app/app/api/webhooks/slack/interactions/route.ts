/**
 * Slack interactivity endpoint — Block Kit button + modal callbacks.
 *
 * Verifies HMAC, parses the URL-encoded `payload` field, looks up the
 * install row, then defers handling past the 3-second Slack ack via
 * `after()`. Approval actions (`sendero_approval.*`) flip the booking
 * status, swap the card via chat.update, and resume any paused
 * workflow run waiting on the booking. Other action prefixes are no-ops
 * for now (future handlers slot into `handleInteraction`).
 *
 * Hardening: the resolved install's `teamId` / `enterpriseId` are
 * compared against the payload's claims before any state mutation —
 * defence against malformed payloads.
 */

import { after, NextResponse, type NextRequest } from 'next/server';
import { env } from '@sendero/env';
import { prisma } from '@sendero/database';
import type { SlackInstall as SlackInstallRow } from '@prisma/client';
import {
  buildResolvedBlocks,
  createSlackClient,
  parseApprovalAction,
  parseInteractionBody,
  respondToInteraction,
  updateMessage,
  verifySlackSignature,
  type BlockActionsPayload,
} from '@sendero/slack';
import { toolList } from '@sendero/tools';
import { findWorkflow, resumeRun, type ToolRegistry, type WorkflowRun } from '@sendero/workflows';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const signingSecret = env.slackSigningSecret();
  if (!signingSecret) {
    return NextResponse.json({ error: 'slack_not_configured' }, { status: 503 });
  }

  const rawBody = await req.text();
  const verify = verifySlackSignature(
    rawBody,
    {
      'x-slack-request-timestamp': req.headers.get('x-slack-request-timestamp'),
      'x-slack-signature': req.headers.get('x-slack-signature'),
    },
    { signingSecret }
  );
  if (verify.ok === false) {
    return NextResponse.json({ error: verify.reason }, { status: 401 });
  }

  const payload: BlockActionsPayload | null = parseInteractionBody(rawBody);
  if (!payload || payload.type !== 'block_actions') {
    return NextResponse.json({});
  }

  const teamId = payload.team?.id ?? null;
  const enterpriseId = payload.enterprise?.id ?? null;
  if (!teamId) {
    return NextResponse.json({ error: 'missing_team_id' }, { status: 400 });
  }

  const install = await prisma.slackInstall.findFirst({
    where: {
      teamId,
      ...(enterpriseId ? { enterpriseId } : {}),
    },
  });
  if (!install) {
    return NextResponse.json({ error: 'unknown_install' }, { status: 404 });
  }
  if (install.teamId !== teamId || (install.enterpriseId ?? null) !== (enterpriseId ?? null)) {
    return NextResponse.json({ error: 'install_mismatch' }, { status: 403 });
  }

  // Defer all handler work past the ack — Slack only needs `{}` within
  // 3s; the booking update + workflow resume can run for longer.
  after(() => handleInteraction(payload, install));

  return NextResponse.json({});
}

async function handleInteraction(
  payload: BlockActionsPayload,
  install: SlackInstallRow
): Promise<void> {
  try {
    for (const action of payload.actions) {
      const prefix = action.action_id.split('.')[0];
      if (prefix === 'sendero_approval') {
        await handleApprovalAction(payload, action, install);
        return;
      }
    }
    // No matching handler. Future interaction prefixes plug in here.
  } catch (err) {
    console.error('[slack/interactions] dispatch failed:', err);
    try {
      await respondToInteraction(payload.response_url, {
        text: 'Something went wrong processing that action. The engineering team has been notified.',
        response_type: 'ephemeral',
        replace_original: false,
      });
    } catch (postErr) {
      console.error('[slack/interactions] error response failed:', postErr);
    }
  }
}

async function handleApprovalAction(
  payload: BlockActionsPayload,
  action: BlockActionsPayload['actions'][number],
  install: SlackInstallRow
): Promise<void> {
  const parsed = parseApprovalAction(action);
  if (!parsed) return;

  // Only `approve`/`reject` mutate state; `open` is a link-out.
  if (parsed.decision === 'open') return;

  if (install.tenantId !== parsed.tenantId) {
    await respondToInteraction(payload.response_url, {
      text: 'This approval is not linked to your Sendero workspace.',
      response_type: 'ephemeral',
      replace_original: false,
    });
    return;
  }

  // Flip the booking status + persist the approver's decision. The
  // actual booking + settlement is async (Phase 3) — here we just
  // record the signal and swap the card.
  //
  // TODO(slack-user-mapping): resolve `payload.user.id` → Sendero User via
  // `resolveSenderoUser()` so approval audit rows can reference the
  // canonical Sendero userId alongside the Slack-side `approvedBy`. The
  // Slack-side ID stays — it's load-bearing for `chat.update` attribution
  // and for the `approverSlackUserId` field on workflow resume.
  await prisma.booking.update({
    where: { id: parsed.bookingId },
    data: {
      status: parsed.decision === 'approve' ? 'confirmed' : 'canceled',
      metadata: {
        approvedBy: payload.user.id,
        decision: parsed.decision,
        decidedAt: new Date().toISOString(),
      },
    },
  });

  const booking = await prisma.booking.findUnique({
    where: { id: parsed.bookingId },
    select: {
      totalUsd: true,
      segments: true,
      tenantId: true,
    },
  });

  if (payload.channel && payload.message) {
    const client = createSlackClient(install.botToken);
    await updateMessage(client, {
      channel: payload.channel.id,
      ts: payload.message.ts,
      blocks: buildResolvedBlocks(
        {
          tenantId: parsed.tenantId,
          tripId: parsed.tripId,
          bookingId: parsed.bookingId,
          travelerName: 'Traveler',
          route: '—',
          departAt: '—',
          amountUsd: booking ? Number(booking.totalUsd) : 0,
          fareClass: '—',
        },
        parsed.decision,
        payload.user.id
      ),
    });
  }

  // Resume any paused workflow run that's waiting on this booking's
  // approval. Phase 6 captured the pause into Session.threadContext
  // with the bookingId in the pausePayload; we look that up here.
  try {
    await resumePausedRunForBooking({
      tenantId: parsed.tenantId,
      bookingId: parsed.bookingId,
      decision: parsed.decision,
      approverSlackUserId: payload.user.id,
    });
  } catch (err) {
    console.error('[slack/interactions] workflow resume failed:', err);
  }
}

// ─── Workflow resume ──────────────────────────────────────────────────
//
// Reactive workflow completion — when the approver decides, any paused
// `sendero.book_flight` run waiting on this booking is resumed with
// `{ decision, approverId }`. Idempotent: if no paused Session matches,
// this is a no-op and the approval simply stands as a booking-status
// change.

async function resumePausedRunForBooking(args: {
  tenantId: string;
  bookingId: string;
  decision: 'approve' | 'reject';
  approverSlackUserId: string;
}): Promise<void> {
  const candidates = await prisma.session.findMany({
    where: { tenantId: args.tenantId, expiresAt: { gte: new Date() } },
    orderBy: { createdAt: 'desc' },
    take: 32,
    select: { id: true, userId: true, threadContext: true },
  });

  for (const session of candidates) {
    const ctx = parseWorkflowContext(session.threadContext);
    if (!ctx) continue;
    if (!bookingMatches(ctx.scratchpad, args.bookingId)) continue;

    const workflow = findWorkflow(ctx.workflowId);
    if (!workflow) continue;

    const tools = buildToolRegistryForTenant({
      tenantId: args.tenantId,
      userId: session.userId ?? 'guest',
    });

    const resumed: WorkflowRun = await resumeRun({
      workflow,
      run: {
        workflowId: ctx.workflowId,
        runId: ctx.runId,
        status: 'paused',
        startedAt: new Date(),
        pausedAt: new Date(),
        pauseReason: ctx.pauseReason,
        pausePayload: ctx.pausePayload,
        scratchpad: ctx.scratchpad,
        trail: [],
        nextStepId: ctx.pausedStepId,
      },
      resolution: {
        decision: args.decision,
        approverSlackUserId: args.approverSlackUserId,
        approvedAt: new Date().toISOString(),
      },
      tools,
    });

    if (resumed.status !== 'paused') {
      await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    }
    // One matching session resumed — stop scanning. A booking only has one
    // active approval pause at a time.
    return;
  }
}

interface WorkflowPauseContext {
  runId: string;
  workflowId: string;
  pausedStepId: string;
  pauseReason: 'approval' | 'otp' | '3ds' | 'user_reply' | 'external_event';
  pausePayload?: Record<string, unknown>;
  scratchpad: Record<string, unknown>;
}

function parseWorkflowContext(raw: unknown): WorkflowPauseContext | null {
  if (!raw || typeof raw !== 'object') return null;
  const ctx = raw as Partial<WorkflowPauseContext>;
  if (
    typeof ctx.runId !== 'string' ||
    typeof ctx.workflowId !== 'string' ||
    typeof ctx.pausedStepId !== 'string' ||
    typeof ctx.pauseReason !== 'string' ||
    typeof ctx.scratchpad !== 'object'
  ) {
    return null;
  }
  return ctx as WorkflowPauseContext;
}

function bookingMatches(scratchpad: Record<string, unknown>, bookingId: string): boolean {
  const dive = (obj: unknown): boolean => {
    if (!obj || typeof obj !== 'object') return false;
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (k === 'bookingId' && v === bookingId) return true;
      if (typeof v === 'object' && v !== null && dive(v)) return true;
    }
    return false;
  };
  return dive(scratchpad);
}

function buildToolRegistryForTenant(ctx: { tenantId: string; userId: string }): ToolRegistry {
  const registry: ToolRegistry = {};
  for (const tool of toolList) {
    registry[tool.name] = async args =>
      tool.handler(args as never, {
        traveler: { userId: ctx.userId, tenantId: ctx.tenantId },
      });
  }
  return registry;
}
