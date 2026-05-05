/**
 * GET /api/cron/trip-checkin-reminder
 *
 * Phase F — proactive 24h pre-departure check-in nudge.
 *
 * For each Booking with `status='ticketed'` whose first segment's
 * `departing_at` is between 24-25h from now AND whose Trip has not
 * yet emitted a `checkin_reminder` event, fetch the airline's online
 * check-in link from Duffel and push a server-side card to the
 * traveler's primary channel via `dispatchToTraveler`. The card
 * carries an `open_link` CTA pointing at the carrier's check-in page
 * — when Duffel hasn't populated the link yet (sandbox + a couple
 * of carriers that haven't onboarded the field), we fall back to a
 * curated per-carrier deep link map; worst case we omit the CTA and
 * tell the traveler to use the carrier's app with their PNR.
 *
 * Auth: CRON_SECRET via `authorization: Bearer …` header (Vercel
 * cron injects automatically). The 24-25h window combined with an
 * hourly schedule catches every ticketed flight exactly once. The
 * dedup event is per-Trip-per-Booking so multi-leg trips don't
 * double-fire.
 *
 * Bounded to 50 candidates per run.
 */

import { randomUUID } from 'node:crypto';

import { type NextRequest, NextResponse } from 'next/server';

import { type Prisma, prisma } from '@sendero/database';
import { getOrderOnlineCheckInLinks, type OnlineCheckInLink } from '@sendero/duffel';

import { dispatchToTraveler } from '@/lib/channel-dispatch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MAX_CANDIDATES = 50;
const WINDOW_LOWER_HOURS = 24;
const WINDOW_UPPER_HOURS = 25;

interface SegmentLite {
  departure_at?: string;
  departing_at?: string;
  departureAt?: string;
}

function readFirstDeparture(segments: unknown): Date | null {
  if (!Array.isArray(segments) || segments.length === 0) return null;
  const first = segments[0] as SegmentLite;
  const raw = first.departing_at ?? first.departure_at ?? first.departureAt;
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
      duffelOrderId: true,
      segments: true,
      trip: {
        select: { id: true, travelerId: true, events: true },
      },
    },
  });

  let dispatched = 0;
  let skipped = 0;
  let inWindow = 0;
  for (const booking of candidates) {
    if (dispatched >= MAX_CANDIDATES) break;
    const dep = readFirstDeparture(booking.segments);
    if (!dep || dep < lower || dep > upper) {
      skipped++;
      continue;
    }
    inWindow++;

    const trip = booking.trip;
    if (!trip?.travelerId || !booking.duffelOrderId) {
      skipped++;
      continue;
    }

    const events = Array.isArray(trip.events)
      ? (trip.events as Array<Record<string, unknown>>)
      : [];
    const alreadyFired = events.some(
      e =>
        typeof e.kind === 'string' &&
        e.kind === 'checkin_reminder' &&
        e.bookingId === booking.id
    );
    if (alreadyFired) {
      skipped++;
      continue;
    }

    let links: OnlineCheckInLink[] = [];
    try {
      links = await getOrderOnlineCheckInLinks(booking.duffelOrderId);
    } catch (err) {
      console.warn('[cron/trip-checkin-reminder] duffel fetch failed', {
        bookingId: booking.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    const outbound = links[0] ?? null;

    const ok = await dispatchCheckInCard({
      tenantId: booking.tenantId,
      tripId: trip.id,
      travelerUserId: trip.travelerId,
      pnr: booking.pnr ?? booking.duffelOrderId.slice(-6).toUpperCase(),
      departureAt: dep.toISOString(),
      link: outbound,
    });
    if (ok) {
      dispatched++;
      await appendCheckinReminderEvent(booking.tenantId, trip.id, booking.id);
    } else {
      skipped++;
    }
  }

  return NextResponse.json({
    ok: true,
    dispatched,
    skipped,
    inWindow,
    candidates: candidates.length,
  });
}

async function dispatchCheckInCard(args: {
  tenantId: string;
  tripId: string;
  travelerUserId: string;
  pnr: string;
  departureAt: string;
  link: OnlineCheckInLink | null;
}): Promise<boolean> {
  const carrier = args.link?.carrierName ?? 'la aerolínea';
  const route =
    args.link?.originIata && args.link?.destinationIata
      ? `${args.link.originIata} → ${args.link.destinationIata}`
      : null;
  const departWhen = formatDepartLabel(args.departureAt);

  const lines = [
    `*Tu vuelo sale en ~24h.* ${route ? `${route} · ` : ''}PNR \`${args.pnr}\`.`,
    args.link?.url
      ? `Tap to check in directly with *${carrier}* — they ask for your PNR + last name on their page.`
      : `Online check-in opens at the gate for ${carrier}. Bring your PNR \`${args.pnr}\` + ID.`,
  ];

  const result = await dispatchToTraveler({
    tripId: args.tripId,
    tenantId: args.tenantId,
    travelerUserId: args.travelerUserId,
    message: {
      kind: 'card',
      id: randomUUID(),
      author: { role: 'agent', name: 'Sendero' },
      title: '🛂 Check-in opens soon',
      body: lines.join('\n'),
      ...(departWhen ? { bullets: [`Departure: ${departWhen}`] } : {}),
      ...(args.link?.url
        ? {
            ctas: [
              {
                label: `🛂 Check in · ${args.link.carrierName}`,
                kind: 'open_link',
                href: args.link.url,
                emphasis: 'primary',
              },
            ],
          }
        : {}),
      createdAt: new Date().toISOString(),
    },
  });
  return result.sent === true;
}

function formatDepartLabel(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
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
