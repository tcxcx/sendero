/**
 * GET /api/cron/post-trip-feedback
 *
 * D3 — proactive post-trip ERC-8004 feedback prompt.
 *
 * For each Trip with `status='completed'` whose latest segment's
 * `arrival_at` is between 24-25h ago AND has not yet emitted a
 * `give_feedback` event, send one canonical channel message through
 * the traveler's primary channel. Replies land back in the same
 * Slack/WhatsApp agent loop and route to `complete_trip` /
 * `give_feedback`, writing feedback to the tenant agency's ERC-8004
 * reputation identity, not Sendero's platform identity.
 *
 * Auth: CRON_SECRET via the `authorization: Bearer …` header (Vercel
 * cron injects automatically). 24-25h window ensures the cron firing
 * once an hour catches every completed trip exactly once without
 * re-prompting.
 *
 * Bounded to 50 candidates per run.
 */

import { type NextRequest, NextResponse } from 'next/server';

import { type Prisma, prisma } from '@sendero/database';
import { env } from '@sendero/env';

import { dispatchToTraveler } from '@/lib/channel-dispatch';
import type { ChannelMessage } from '@/lib/channel-render';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MAX_CANDIDATES = 50;

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (expected && req.headers.get('authorization') !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const upper = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const lower = new Date(now.getTime() - 25 * 60 * 60 * 1000);

  // Pick completed trips with last update in the 24-25h window.
  // Filter by absence of give_feedback event in the application layer
  // since Trip.events is a JSON array; cheap because the candidate
  // window is small.
  const candidates = await prisma.trip.findMany({
    where: {
      status: 'completed',
      updatedAt: { gte: lower, lte: upper },
    },
    orderBy: { updatedAt: 'asc' },
    take: MAX_CANDIDATES,
    select: { id: true, tenantId: true, travelerId: true, events: true },
  });

  let triggered = 0;
  let skipped = 0;
  for (const trip of candidates) {
    const events = Array.isArray(trip.events)
      ? (trip.events as Array<Record<string, unknown>>)
      : [];
    const alreadyAsked = events.some(
      e =>
        typeof e.kind === 'string' &&
        (e.kind === 'feedback_requested' || e.toolName === 'give_feedback')
    );
    if (alreadyAsked) {
      skipped++;
      continue;
    }
    if (!trip.travelerId) {
      skipped++;
      continue;
    }

    const fired = await dispatchFeedbackPrompt({
      tenantId: trip.tenantId,
      tripId: trip.id,
      travelerUserId: trip.travelerId,
    });
    if (fired) {
      triggered++;
      await appendFeedbackRequestedEvent(trip.tenantId, trip.id);
    } else {
      skipped++;
    }
  }

  return NextResponse.json({ ok: true, triggered, skipped, candidates: candidates.length });
}

/**
 * Send the rating prompt through the canonical traveler channel. That
 * keeps Slack and WhatsApp behavior aligned and makes the operator
 * console preview match the traveler copy.
 *
 * WhatsApp keeps the old Kapso ACTION_REQUIRED trigger as a fallback
 * for local/sandbox installs that cannot yet send direct channel
 * messages. The primary path is still `dispatchToTraveler`.
 *
 * Returns false on any error so the caller can mark the candidate as
 * skipped and re-try on the next cron tick.
 */
async function dispatchFeedbackPrompt(args: {
  tenantId: string;
  tripId: string;
  travelerUserId: string;
}): Promise<boolean> {
  const message: ChannelMessage = {
    kind: 'card',
    id: `post_trip_feedback_${args.tripId}`,
    author: { role: 'agent', name: 'Sendero' },
    title: 'Rate this trip',
    body: "How did your agency do on this trip? Reply with 1-5 stars. Your rating updates this agency's on-chain ERC-8004 reputation, not Sendero's platform reputation.",
    bullets: ['5 = excellent', '3 = okay', '1 = needs attention'],
    createdAt: new Date().toISOString(),
  };

  const sent = await dispatchToTraveler({
    tenantId: args.tenantId,
    tripId: args.tripId,
    travelerUserId: args.travelerUserId,
    message,
  });
  if (sent.sent === true) return true;

  const identity = await prisma.channelIdentity.findFirst({
    where: { tenantId: args.tenantId, userId: args.travelerUserId, kind: 'whatsapp' },
    select: { externalUserId: true },
  });
  if (!identity?.externalUserId) {
    console.warn('[cron/post-trip-feedback] no traveler channel', {
      tenantId: args.tenantId,
      tripId: args.tripId,
      reason: sent.reason,
      detail: sent.detail,
    });
    return false;
  }

  const apiKey = env.kapsoApiKey();
  const workflowId = env.kapsoTenantWorkflowId();
  if (!apiKey || !workflowId) {
    console.warn('[cron/post-trip-feedback] kapso not configured', {
      hasKey: Boolean(apiKey),
      hasWorkflowId: Boolean(workflowId),
    });
    return false;
  }

  try {
    const url = `${env.kapsoApiBaseUrl()}/platform/v1/workflow_executions`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        execution: {
          workflow_id: workflowId,
          trigger_type: 'api_call',
          input: {
            kind: 'post_trip_feedback',
            travelerPhone: identity.externalUserId,
            tripId: args.tripId,
            tenantId: args.tenantId,
          },
        },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn('[cron/post-trip-feedback] kapso execution start non-OK', {
        status: res.status,
        body: body.slice(0, 200),
      });
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[cron/post-trip-feedback] kapso execution start failed', {
      tripId: args.tripId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

async function appendFeedbackRequestedEvent(tenantId: string, tripId: string): Promise<void> {
  const entry: Prisma.InputJsonObject = {
    id: `feedback_requested_${tripId}_${Date.now()}`,
    kind: 'feedback_requested',
    direction: 'internal',
    channel: 'internal',
    createdAt: new Date().toISOString(),
  };
  try {
    await prisma.$executeRaw`
      UPDATE trips
         SET events = COALESCE(events, '[]'::jsonb) || ${entry as unknown as Prisma.JsonValue}::jsonb
       WHERE id = ${tripId} AND "tenantId" = ${tenantId}
    `;
  } catch (err) {
    console.warn('[cron/post-trip-feedback] event append failed', {
      tripId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
