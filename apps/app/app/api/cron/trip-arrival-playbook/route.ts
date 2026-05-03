/**
 * GET /api/cron/trip-arrival-playbook
 *
 * Phase 4 — proactive arrival-window playbook trigger.
 *
 * For each Booking with `status='ticketed'` whose LAST segment's
 * `arriving_at` is within ±1h of now AND whose Trip has not yet
 * emitted an `arrival_playbook` event, fire a Kapso `api_call`
 * workflow execution with `kind: 'arrival_playbook'`. Kapso resumes
 * the WhatsApp thread; the agent calls `airport_arrival_playbook`
 * (immigration tips, sim cards, taxi-scam warnings) for the
 * arrival airport.
 *
 * Auth: CRON_SECRET via `authorization: Bearer …`. The 2h window
 * paired with a 30-minute schedule guarantees one fire per arrival,
 * close to landing. Dedup is per-Trip so a multi-segment itinerary
 * doesn't fire twice.
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
const WINDOW_HOURS = 1;

interface SegmentLite {
  arrival_at?: string;
  arriving_at?: string;
  destination?: string;
  arrivalAirport?: string;
}

function readLastArrival(segments: unknown): { iso: Date; airport: string | null } | null {
  if (!Array.isArray(segments) || segments.length === 0) return null;
  const last = segments[segments.length - 1] as SegmentLite;
  const raw = last.arriving_at ?? last.arrival_at;
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  const airport = last.destination ?? last.arrivalAirport ?? null;
  return { iso: d, airport };
}

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (expected && req.headers.get('authorization') !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const lower = new Date(now.getTime() - WINDOW_HOURS * 60 * 60 * 1000);
  const upper = new Date(now.getTime() + WINDOW_HOURS * 60 * 60 * 1000);

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
    const arrival = readLastArrival(booking.segments);
    if (!arrival || arrival.iso < lower || arrival.iso > upper) {
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
      e => typeof e.kind === 'string' && e.kind === 'arrival_playbook'
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

    const fired = await fireKapsoArrivalTrigger({
      tenantId: booking.tenantId,
      tripId: trip.id,
      bookingId: booking.id,
      pnr: booking.pnr ?? null,
      arrivalAirport: arrival.airport,
      travelerPhone: identity.externalUserId,
      arrivalIso: arrival.iso.toISOString(),
    });
    if (fired) {
      triggered++;
      await appendArrivalPlaybookEvent(booking.tenantId, trip.id, booking.id);
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

async function fireKapsoArrivalTrigger(args: {
  tenantId: string;
  tripId: string;
  bookingId: string;
  pnr: string | null;
  arrivalAirport: string | null;
  travelerPhone: string;
  arrivalIso: string;
}): Promise<boolean> {
  const apiKey = env.kapsoApiKey();
  const workflowId = env.kapsoTenantWorkflowId();
  if (!apiKey || !workflowId) {
    console.warn('[cron/trip-arrival-playbook] kapso not configured', {
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
            kind: 'arrival_playbook',
            travelerPhone: args.travelerPhone,
            tripId: args.tripId,
            tenantId: args.tenantId,
            bookingId: args.bookingId,
            pnr: args.pnr,
            arrivalAirport: args.arrivalAirport,
            arrivalIso: args.arrivalIso,
          },
        },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn('[cron/trip-arrival-playbook] kapso execution start non-OK', {
        status: res.status,
        body: body.slice(0, 200),
      });
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[cron/trip-arrival-playbook] kapso execution start failed', {
      tripId: args.tripId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

async function appendArrivalPlaybookEvent(
  tenantId: string,
  tripId: string,
  bookingId: string
): Promise<void> {
  const entry: Prisma.InputJsonObject = {
    id: `arrival_playbook_${tripId}_${Date.now()}`,
    kind: 'arrival_playbook',
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
    console.warn('[cron/trip-arrival-playbook] event append failed', {
      tripId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
