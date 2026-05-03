/**
 * GET /api/cron/trip-checkin-reminder
 *
 * Phase 4 — proactive 24h pre-departure check-in nudge.
 *
 * For each Booking with `status='ticketed'` whose first segment's
 * `departing_at` is between 24-25h from now AND whose Trip has not
 * yet emitted a `checkin_reminder` event, fire a Kapso `api_call`
 * workflow execution with `kind: 'pre_departure_reminder'`. Kapso's
 * runtime resumes the traveler's WhatsApp thread and the agent calls
 * `trip_checkin_reminder` (already in the tool registry) to compose
 * the timezone-aware nudge.
 *
 * Auth: CRON_SECRET via `authorization: Bearer …` header (Vercel
 * cron injects automatically). The 24-25h window combined with an
 * hourly schedule catches every ticketed flight exactly once. The
 * dedup event is per-Trip (not per-Booking) so multi-leg trips don't
 * double-fire.
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
const WINDOW_LOWER_HOURS = 24;
const WINDOW_UPPER_HOURS = 25;

interface SegmentLite {
  departure_at?: string;
  departing_at?: string;
}

function readFirstDeparture(segments: unknown): Date | null {
  if (!Array.isArray(segments) || segments.length === 0) return null;
  const first = segments[0] as SegmentLite;
  const raw = first.departing_at ?? first.departure_at;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (expected && req.headers.get('authorization') !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const lower = new Date(now.getTime() + WINDOW_LOWER_HOURS * 60 * 60 * 1000);
  const upper = new Date(now.getTime() + WINDOW_UPPER_HOURS * 60 * 60 * 1000);

  // Pull a generous super-set keyed on Booking status, then filter by
  // departure window in app code. Booking.segments is JSON so we can't
  // index on it directly; the bounding query is cheap because
  // status='ticketed' is heavily indexed and the candidate window
  // shrinks naturally as time passes.
  const candidates = await prisma.booking.findMany({
    where: {
      status: 'ticketed',
      kind: 'flight',
      bookedAt: { gte: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000) },
    },
    orderBy: { bookedAt: 'desc' },
    take: 500,
    select: {
      id: true,
      tenantId: true,
      tripId: true,
      pnr: true,
      segments: true,
      trip: {
        select: { id: true, travelerId: true, events: true },
      },
    },
  });

  let triggered = 0;
  let skipped = 0;
  let inWindow = 0;
  for (const booking of candidates) {
    if (triggered >= MAX_CANDIDATES) break;
    const dep = readFirstDeparture(booking.segments);
    if (!dep || dep < lower || dep > upper) {
      skipped++;
      continue;
    }
    inWindow++;

    const trip = booking.trip;
    if (!trip?.travelerId) {
      skipped++;
      continue;
    }

    const events = Array.isArray(trip.events) ? (trip.events as Array<Record<string, unknown>>) : [];
    const alreadyFired = events.some(
      e => typeof e.kind === 'string' && e.kind === 'checkin_reminder'
    );
    if (alreadyFired) {
      skipped++;
      continue;
    }

    const identity = await prisma.channelIdentity.findFirst({
      where: { tenantId: booking.tenantId, userId: trip.travelerId, kind: 'whatsapp' },
      select: { externalUserId: true },
    });
    if (!identity?.externalUserId) {
      skipped++;
      continue;
    }

    const fired = await fireKapsoCheckinTrigger({
      tenantId: booking.tenantId,
      tripId: trip.id,
      bookingId: booking.id,
      pnr: booking.pnr ?? null,
      travelerPhone: identity.externalUserId,
      departureIso: dep.toISOString(),
    });
    if (fired) {
      triggered++;
      await appendCheckinReminderEvent(booking.tenantId, trip.id, booking.id);
    } else {
      skipped++;
    }
  }

  return NextResponse.json({
    ok: true,
    triggered,
    skipped,
    inWindow,
    candidates: candidates.length,
  });
}

async function fireKapsoCheckinTrigger(args: {
  tenantId: string;
  tripId: string;
  bookingId: string;
  pnr: string | null;
  travelerPhone: string;
  departureIso: string;
}): Promise<boolean> {
  const apiKey = env.kapsoApiKey();
  const workflowId = env.kapsoTenantWorkflowId();
  if (!apiKey || !workflowId) {
    console.warn('[cron/trip-checkin-reminder] kapso not configured', {
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
            kind: 'pre_departure_reminder',
            travelerPhone: args.travelerPhone,
            tripId: args.tripId,
            tenantId: args.tenantId,
            bookingId: args.bookingId,
            pnr: args.pnr,
            departureIso: args.departureIso,
          },
        },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn('[cron/trip-checkin-reminder] kapso execution start non-OK', {
        status: res.status,
        body: body.slice(0, 200),
      });
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[cron/trip-checkin-reminder] kapso execution start failed', {
      tripId: args.tripId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

async function appendCheckinReminderEvent(
  tenantId: string,
  tripId: string,
  bookingId: string
): Promise<void> {
  const entry: Prisma.InputJsonObject = {
    id: `checkin_reminder_${tripId}_${Date.now()}`,
    kind: 'checkin_reminder',
    direction: 'internal',
    channel: 'internal',
    bookingId,
    createdAt: new Date().toISOString(),
  };
  try {
    await prisma.$executeRaw`
      UPDATE trips
         SET events = COALESCE(events, '[]'::jsonb) || ${entry as unknown as Prisma.JsonValue}::jsonb
       WHERE id = ${tripId} AND "tenantId" = ${tenantId}
    `;
  } catch (err) {
    console.warn('[cron/trip-checkin-reminder] event append failed', {
      tripId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
