/**
 * GET /api/cron/passport-expiry-reminder
 *
 * Phase D — long-tail retention loop.
 *
 * Weekly sweep of `PassportVault` rows whose `expiresOn` falls inside
 * the next 6 months. For travelers who have a recent booking footprint
 * (60-day window) we push a friendly card via `dispatchToTraveler`:
 * "Your passport expires soon — renew before your next trip." Travelers
 * who haven't booked recently get nothing — we don't spam dormant
 * accounts.
 *
 * Idempotency: per-vault-row reminders are tracked via
 * `Trip.events` is wrong shape; instead we tag the User's most recent
 * Trip with a `passport_expiry_reminder` event. Per-month dedup keeps
 * the cadence reasonable (a passport expiring in 4mo gets one card
 * this month, one next month, one the month after — not a card every
 * Monday).
 *
 * Auth: CRON_SECRET via `authorization: Bearer …` header.
 *
 * Vercel cron schedule: `0 12 * * 1` (Mondays at noon UTC).
 */

import { randomUUID } from 'node:crypto';

import { type NextRequest, NextResponse } from 'next/server';

import { type Prisma, prisma } from '@sendero/database';

import { dispatchToTraveler } from '@/lib/channel-dispatch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MAX_DISPATCHES = 100;
const REMINDER_WINDOW_MONTHS = 6;
const RECENT_BOOKING_DAYS = 60;
/** Don't double-fire within 28 days for the same vault row. */
const COOLDOWN_DAYS = 28;

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (expected && req.headers.get('authorization') !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const upper = new Date(now);
  upper.setMonth(upper.getMonth() + REMINDER_WINDOW_MONTHS);
  const recentBookingFrom = new Date(now.getTime() - RECENT_BOOKING_DAYS * 24 * 60 * 60 * 1000);

  // Pull every vault row expiring inside the window AND not revoked.
  // This reads PLAINTEXT signal columns only — no decryption, no PII.
  const candidates = await prisma.passportVault.findMany({
    where: {
      revokedAt: null,
      documentVariant: 'passport',
      expiresOn: { gte: now, lte: upper },
    },
    select: {
      id: true,
      tenantId: true,
      userId: true,
      expiresOn: true,
      nationalityIso3: true,
    },
    take: 500,
  });

  let dispatched = 0;
  let skippedDormant = 0;
  let skippedCooldown = 0;
  let skippedNoChannel = 0;

  for (const v of candidates) {
    if (dispatched >= MAX_DISPATCHES) break;

    // Active-traveler gate — only nudge users who have a recent
    // booking. Without this we'd page travelers who tried Sendero once
    // a year ago + never came back.
    const recentBooking = await prisma.booking.findFirst({
      where: {
        tenantId: v.tenantId,
        trip: { travelerId: v.userId },
        bookedAt: { gte: recentBookingFrom },
      },
      orderBy: { bookedAt: 'desc' },
      select: { id: true, tripId: true, trip: { select: { events: true, id: true } } },
    });
    if (!recentBooking?.trip?.id) {
      skippedDormant++;
      continue;
    }

    // Per-row cooldown — same vault row can't fire more than once per
    // 28 days regardless of how many active trips the traveler has.
    const events = Array.isArray(recentBooking.trip.events)
      ? (recentBooking.trip.events as Array<Record<string, unknown>>)
      : [];
    const cooldownCutoff = new Date(now.getTime() - COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
    const recent = events.find(e => {
      if (e.kind !== 'passport_expiry_reminder' || e.passportVaultId !== v.id) return false;
      const at = typeof e.createdAt === 'string' ? new Date(e.createdAt) : null;
      return at !== null && at > cooldownCutoff;
    });
    if (recent) {
      skippedCooldown++;
      continue;
    }

    const ok = await dispatchExpiryCard({
      tenantId: v.tenantId,
      tripId: recentBooking.trip.id,
      travelerUserId: v.userId,
      expiresOn: v.expiresOn,
    });
    if (!ok) {
      skippedNoChannel++;
      continue;
    }
    dispatched++;
    await appendExpiryReminderEvent(v.tenantId, recentBooking.trip.id, v.id);
  }

  return NextResponse.json({
    ok: true,
    dispatched,
    skippedDormant,
    skippedCooldown,
    skippedNoChannel,
    candidates: candidates.length,
  });
}

async function dispatchExpiryCard(args: {
  tenantId: string;
  tripId: string;
  travelerUserId: string;
  expiresOn: Date | null;
}): Promise<boolean> {
  if (!args.expiresOn) return false;
  const expiryLabel = args.expiresOn.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
  const monthsLeft = Math.max(
    0,
    Math.round((args.expiresOn.getTime() - Date.now()) / (30 * 24 * 60 * 60 * 1000))
  );
  const result = await dispatchToTraveler({
    tripId: args.tripId,
    tenantId: args.tenantId,
    travelerUserId: args.travelerUserId,
    message: {
      kind: 'card',
      id: randomUUID(),
      author: { role: 'agent', name: 'Sendero' },
      title: '📔 Passport heads-up',
      body: `*Tu pasaporte vence en ${expiryLabel}* — about ${monthsLeft} months from today.\n\nMost destinations require 6+ months validity from your travel date. Renew sooner rather than later so your next booking doesn't get blocked at the gate.`,
      ctas: [
        {
          label: 'When are you traveling next?',
          kind: 'reply',
          value: 'plan a trip',
          emphasis: 'primary',
        },
      ],
      createdAt: new Date().toISOString(),
    },
  });
  return result.sent === true;
}

async function appendExpiryReminderEvent(
  tenantId: string,
  tripId: string,
  passportVaultId: string
): Promise<void> {
  const entry: Prisma.InputJsonObject = {
    id: `passport_expiry_${tripId}_${Date.now()}`,
    kind: 'passport_expiry_reminder',
    direction: 'internal',
    channel: 'internal',
    passportVaultId,
    createdAt: new Date().toISOString(),
  };
  try {
    await prisma.$executeRaw`
      UPDATE trips
         SET events = COALESCE(events, '[]'::jsonb) || ${entry as unknown as Prisma.JsonValue}::jsonb
       WHERE id = ${tripId} AND "tenantId" = ${tenantId}
    `;
  } catch (err) {
    console.warn('[cron/passport-expiry-reminder] event append failed', {
      tripId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
