/**
 * GET /api/cron/post-trip-feedback
 *
 * D3 — proactive post-trip ERC-8004 feedback prompt.
 *
 * For each Trip with `status='completed'` whose latest segment's
 * `arrival_at` is between 24-25h ago AND has not yet emitted a
 * `give_feedback` event, send a WhatsApp `ACTION_REQUIRED` template
 * via the Kapso `api_call` workflow trigger. The Kapso agent picks
 * up the resumed conversation, asks the traveler "rate this trip
 * 1-5 stars", and the reply is routed to `give_feedback` via the
 * standard `call_sendero` proxy.
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
    const events = Array.isArray(trip.events) ? (trip.events as Array<Record<string, unknown>>) : [];
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

    // Find the traveler's WhatsApp identity. Skip silently when the
    // trip wasn't WhatsApp-driven (web/Slack/API channels handle
    // their own feedback flow elsewhere).
    const identity = await prisma.channelIdentity.findFirst({
      where: { tenantId: trip.tenantId, userId: trip.travelerId, kind: 'whatsapp' },
      select: { externalUserId: true },
    });
    if (!identity?.externalUserId) {
      skipped++;
      continue;
    }

    const fired = await fireKapsoFeedbackTrigger({
      tenantId: trip.tenantId,
      tripId: trip.id,
      travelerPhone: identity.externalUserId,
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
 * POST a Kapso `api_call` trigger to spawn a workflow execution for
 * this traveler. Kapso's runtime then sends the ACTION_REQUIRED
 * template ("Rate your trip"); the traveler's reply lands as a
 * regular WhatsApp inbound and the agent calls `give_feedback` via
 * `call_sendero` — D3 enum extension makes that reachable.
 *
 * Returns false on any error so the caller can mark the candidate as
 * skipped and re-try on the next cron tick.
 */
async function fireKapsoFeedbackTrigger(args: {
  tenantId: string;
  tripId: string;
  travelerPhone: string;
}): Promise<boolean> {
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
            travelerPhone: args.travelerPhone,
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
