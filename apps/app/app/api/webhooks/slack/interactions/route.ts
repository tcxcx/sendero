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
import { flushLangfuse, scoreGeneration } from '@sendero/langfuse';
import { notifier } from '@sendero/notifications';
import {
  buildResolvedBlocks,
  createSlackClient,
  parseApprovalAction,
  parseInteractionBody,
  respondToInteraction,
  serializeSubmissionResult,
  updateMessage,
  verifySlackSignature,
  ViewRouter,
  type BlockActionsPayload,
  type ViewClosedPayload,
  type ViewSubmissionPayload,
} from '@sendero/slack';
import { handleTripNoteSubmission, TRIP_NOTE_CALLBACK_ID } from '@/lib/slack-views/trip-note';
import { routeSlackAncillaryTap } from '@/lib/ancillary-tap-router';
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

  const payload = parseInteractionBody(rawBody);
  if (!payload) {
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
  if (install.revokedAt !== null) {
    return NextResponse.json({ ok: true, dropped: 'install_revoked' });
  }

  // view_submission MUST ack synchronously — Slack reads the response
  // body to drive the modal lifecycle (close / show errors / push next).
  // No `after()` deferral allowed on this branch.
  //
  // Per-request router so the trip-note handler closes over the
  // resolved install's `tenantId`. Without this, the handler would
  // accept any `private_metadata.tripId` and write across tenants —
  // the modal opener (slash command) takes user-supplied trip ids
  // and stuffs them into private_metadata; only the handler can
  // enforce the tenant gate.
  if (payload.type === 'view_submission') {
    const result = await handleViewSubmission(payload, install.tenantId);
    return NextResponse.json(serializeSubmissionResult(result));
  }

  // view_closed and block_actions both ack with `{}` immediately and
  // run any side-effect work post-ack via `after()`.
  if (payload.type === 'view_closed') {
    after(() => handleViewClosed(payload));
    return NextResponse.json({});
  }

  // block_actions — existing approval-card path, plus future button
  // handlers (e.g. "Add note" → opens the trip-note modal). The
  // discriminated-union narrowing from the early returns above
  // doesn't carry into the after() closure (TS conservatively
  // widens captures), so pin the narrowed type into a const first.
  if (payload.type !== 'block_actions') {
    return NextResponse.json({});
  }
  const blockActionsPayload: BlockActionsPayload = payload;
  after(() => handleInteraction(blockActionsPayload, install));

  return NextResponse.json({});
}

// ─── view-handler routing ─────────────────────────────────────────────
//
// Closed-handler router can be a singleton — view_closed only fires
// with the same `callback_id` shape and doesn't need install scope.
// Submission router is built per-request inside POST so handlers can
// capture the resolved install's tenantId for cross-tenant gating.

const closedRouter = new ViewRouter();

async function handleViewSubmission(payload: ViewSubmissionPayload, tenantId: string) {
  const router = new ViewRouter().registerSubmission(TRIP_NOTE_CALLBACK_ID, p =>
    handleTripNoteSubmission(p, { tenantId })
  );
  try {
    return await router.dispatchSubmission(payload);
  } catch (err) {
    console.error('[slack/interactions] view_submission dispatch failed:', {
      callbackId: payload.view.callback_id,
      userId: payload.user.id,
      error: err instanceof Error ? err.message : String(err),
    });
    // Surface a friendly, blocked-in-modal error rather than crashing the
    // user's modal. Slack closes the modal on any non-`response_action`
    // body, so returning errors keeps the user in place to retry.
    return {
      kind: 'errors' as const,
      errors: { _root: 'Something went wrong saving that. Please retry.' },
    };
  }
}

async function handleViewClosed(payload: ViewClosedPayload): Promise<void> {
  try {
    await closedRouter.dispatchClosed(payload);
  } catch (err) {
    console.error('[slack/interactions] view_closed dispatch failed:', {
      callbackId: payload.view.callback_id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
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
      if (prefix === 'sendero_tool_invoke' || prefix === 'sendero_cancel') {
        // Phase G — fanout button taps (trip_wrap, trip_extend,
        // esim_offer, esim_skip). Encoded by the Slack renderer as
        // `sendero_<cta.kind>.<cta.value>`. Routes to the same
        // Sendero tools the WhatsApp prompt path calls.
        await handleFanoutButtonTap(payload, action, install);
        return;
      }
      if (action.action_id === 'sendero_select_seat' || action.action_id === 'sendero_add_bag') {
        // Pre-booking ancillary picker taps. Slack carries the full
        // JSON-encoded staging payload in `selected_option.value`
        // (overflow menu — seats) or `action.value` (button — bags).
        await handleAncillaryPickerTap(payload, action, install);
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

/**
 * Phase G — handle Sendero fanout button taps (trip wrap-up, eSIM
 * auto-attach, etc.) on Slack. Resolves the Slack user → Sendero
 * userId via SlackUserBinding, then calls the matching Sendero tool
 * over the internal HTTP surface (same path the WhatsApp prompt
 * routing uses). Posts a one-line confirmation back to the channel
 * so the user sees their tap was acknowledged.
 *
 * Action id encoding from `apps/app/lib/channel-render/channels/slack.ts`:
 *   `sendero_tool_invoke.trip_wrap:<tripId>`     → complete_trip
 *   `sendero_tool_invoke.trip_extend:<tripId>`   → set_trip_kind(open_journey)
 *   `sendero_tool_invoke.esim_offer:<iso>:<days>` → search_esim
 *   `sendero_cancel.esim_skip`                   → silent no-op
 */
async function handleFanoutButtonTap(
  payload: BlockActionsPayload,
  action: { action_id: string; value?: string },
  install: SlackInstallRow
): Promise<void> {
  // Strip the `sendero_<kind>.` prefix to get the cta.value.
  const dot = action.action_id.indexOf('.');
  const value = dot >= 0 ? action.action_id.slice(dot + 1) : (action.value ?? '');

  if (!value || value === 'esim_skip') {
    return;
  }

  const slackUserId = payload.user.id;
  // Resolve sendero user id via SlackUserBinding.
  const { prisma } = await import('@sendero/database');
  const binding = await prisma.slackUserBinding.findFirst({
    where: {
      tenantId: install.tenantId,
      slackTeamId: install.teamId,
      slackUserId,
    },
    select: { senderoUserId: true },
  });
  if (!binding) {
    console.warn('[slack/interactions] no SlackUserBinding for tap', {
      slackUserId,
      tenantId: install.tenantId,
    });
    return;
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3010';
  const secret = process.env.AGENT_DISPATCH_SECRET ?? process.env.CRON_SECRET ?? '';
  if (!secret) return;

  const sharedHeaders = {
    'Content-Type': 'application/json',
    'x-sendero-dispatch-secret': secret,
  };

  // Trip wrap-up.
  if (value.startsWith('trip_wrap:')) {
    const tripId = value.slice('trip_wrap:'.length);
    await fetch(`${baseUrl.replace(/\/$/, '')}/api/tools/complete_trip`, {
      method: 'POST',
      headers: sharedHeaders,
      body: JSON.stringify({
        tenantId: install.tenantId,
        // No travelerPhone — pass userId via fallback path inside
        // tools route (resolveTravelerByPhone is the canonical
        // resolver; for Slack travelers we'd need a similar path).
        // Today complete_trip checks `ctx.traveler.userId` and we
        // route via shared secret without a userId stamp. Workaround:
        // include `_userId` in body so the tools route can stamp it.
        _slackSenderoUserId: binding.senderoUserId,
        input: { tripId },
      }),
    }).catch(err => console.warn('[slack/interactions] complete_trip failed', err));
    return;
  }

  // Upgrade to open journey.
  if (value.startsWith('trip_extend:')) {
    const tripId = value.slice('trip_extend:'.length);
    await fetch(`${baseUrl.replace(/\/$/, '')}/api/tools/set_trip_kind`, {
      method: 'POST',
      headers: sharedHeaders,
      body: JSON.stringify({
        tenantId: install.tenantId,
        _slackSenderoUserId: binding.senderoUserId,
        input: { tripId, kind: 'open_journey' },
      }),
    }).catch(err => console.warn('[slack/interactions] set_trip_kind failed', err));
    return;
  }

  // eSIM auto-attach — kick off search_esim. The picker rendering
  // back to Slack lives in a follow-up post (TODO Phase G.4 — for now
  // we just trigger the tool and let the user re-engage via chat).
  if (value.startsWith('esim_offer:')) {
    const [, iso, daysRaw] = value.split(':');
    const days = Number.parseInt(daysRaw ?? '7', 10) || 7;
    await fetch(`${baseUrl.replace(/\/$/, '')}/api/tools/search_esim`, {
      method: 'POST',
      headers: sharedHeaders,
      body: JSON.stringify({
        tenantId: install.tenantId,
        _slackSenderoUserId: binding.senderoUserId,
        input: { destinationIso2: [iso], days },
      }),
    }).catch(err => console.warn('[slack/interactions] search_esim failed', err));
    return;
  }
}

/**
 * Pre-booking ancillary picker tap (Slack overflow menu / button).
 * Resolves the SlackUserBinding so the tools route can attribute the
 * stage to the right Sendero User, then defers all parsing + HTTP
 * envelope work to the shared router. Drift between Slack and
 * WhatsApp body shapes is the failure mode the shared module
 * eliminates.
 *
 * Action ids:
 *   `sendero_select_seat` — overflow option carries seat staging payload
 *   `sendero_add_bag`     — button value carries bag staging payload
 */
async function handleAncillaryPickerTap(
  payload: BlockActionsPayload,
  action: { action_id: string; value?: string; selected_option?: { value: string } },
  install: SlackInstallRow
): Promise<void> {
  const raw = action.selected_option?.value ?? action.value ?? '';
  if (!raw) return;

  const { prisma } = await import('@sendero/database');
  const binding = await prisma.slackUserBinding.findFirst({
    where: {
      tenantId: install.tenantId,
      slackTeamId: install.teamId,
      slackUserId: payload.user.id,
    },
    select: { senderoUserId: true },
  });
  if (!binding) {
    console.warn('[slack/interactions] no SlackUserBinding for ancillary tap', {
      slackUserId: payload.user.id,
      tenantId: install.tenantId,
    });
    return;
  }

  const result = await routeSlackAncillaryTap({
    actionId: action.action_id,
    rawValue: raw,
    tenantId: install.tenantId,
    senderoUserId: binding.senderoUserId,
  }).catch(err => {
    console.warn('[slack/interactions] ancillary tap router threw', err);
    return { ok: false, reason: 'parse_failed' as const };
  });

  if (!result.ok) {
    if (result.reason === 'parse_failed' || result.reason === 'no_secret') {
      console.warn('[slack/interactions] ancillary tap not routed', {
        actionId: action.action_id,
        reason: result.reason,
      });
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
      pnr: true,
      metadata: true,
      trip: {
        select: {
          id: true,
          intent: true,
          traveler: { select: { email: true, displayName: true } },
        },
      },
    },
  });

  // Score the originating agent generation with the human's decision.
  // Booking.metadata.traceId is only present when confirm_booking ran
  // through a Langfuse-traced agent turn. Fire-and-forget; never blocks
  // the Slack ack.
  const bookingTraceId =
    booking?.metadata && typeof (booking.metadata as Record<string, unknown>).traceId === 'string'
      ? ((booking.metadata as Record<string, unknown>).traceId as string)
      : null;
  if (bookingTraceId) {
    void Promise.resolve().then(async () => {
      try {
        await scoreGeneration(
          bookingTraceId,
          parsed.decision === 'approve' ? 'approved' : 'rejected'
        );
        await flushLangfuse();
      } catch {
        // already logged inside the helpers
      }
    });
  }

  // Email parity with the Slack approval flip. On approve, the traveler
  // gets a hold-confirmed receipt. Failures are swallowed so the Slack
  // ack flow stays green even if Resend is down or unconfigured.
  if (parsed.decision === 'approve' && booking?.trip?.traveler?.email) {
    await sendHoldConfirmedEmail({
      bookingId: parsed.bookingId,
      tripId: parsed.tripId,
      pnr: booking.pnr,
      segments: booking.segments,
      tripIntent: booking.trip.intent,
      travelerEmail: booking.trip.traveler.email,
      travelerName: booking.trip.traveler.displayName ?? 'Traveler',
    }).catch(err => console.error('[slack/interactions] hold_confirmed email failed:', err));
  }

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

// ─── trip-event email ─────────────────────────────────────────────────

async function sendHoldConfirmedEmail(args: {
  bookingId: string;
  tripId: string;
  pnr: string | null;
  segments: unknown;
  tripIntent: unknown;
  travelerEmail: string;
  travelerName: string;
}): Promise<void> {
  const tripUrl = buildTripUrl(args.tripId);
  const tripSummary = summarizeTripIntent(args.tripIntent) ?? 'your upcoming trip';
  const departureSummary = summarizeFirstSegment(args.segments) ?? tripSummary;
  await notifier().sendHoldConfirmed(args.travelerEmail, {
    tripSummary,
    travelerName: args.travelerName,
    pnr: args.pnr ?? args.bookingId,
    departureSummary,
    tripUrl,
  });
}

function buildTripUrl(tripId: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? 'https://app.sendero.travel';
  return `${base}/dashboard/console?tripId=${encodeURIComponent(tripId)}`;
}

function summarizeTripIntent(intent: unknown): string | null {
  if (!intent || typeof intent !== 'object') return null;
  const i = intent as { origin?: unknown; dest?: unknown; destination?: unknown };
  const origin = typeof i.origin === 'string' ? i.origin : null;
  const dest =
    typeof i.dest === 'string' ? i.dest : typeof i.destination === 'string' ? i.destination : null;
  if (origin && dest) return `${origin} → ${dest}`;
  if (dest) return String(dest);
  return null;
}

function summarizeFirstSegment(segments: unknown): string | null {
  if (!Array.isArray(segments) || segments.length === 0) return null;
  const first = segments[0] as Record<string, unknown>;
  const origin = typeof first.origin === 'string' ? first.origin : null;
  const dest = typeof first.destination === 'string' ? first.destination : null;
  const depart =
    typeof first.departAt === 'string'
      ? first.departAt
      : typeof first.departingAt === 'string'
        ? first.departingAt
        : null;
  const parts = [origin && dest ? `${origin} → ${dest}` : (origin ?? dest), depart].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}
