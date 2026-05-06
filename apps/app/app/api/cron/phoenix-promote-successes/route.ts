/**
 * GET /api/cron/phoenix-promote-successes
 *
 * Every 6h: pulls confirmed bookings from the last window and pushes
 * them as positive examples into the Phoenix `sendero-recall` dataset,
 * where `recall_similar_turns` reads them at agent runtime.
 *
 * Why not eval-score-filter at promotion time? Langfuse evaluators
 * are fire-and-forget post-meter — by the time the cron runs, scores
 * may not have landed for the most recent turns. Phoenix-side recall
 * filters on score at READ time (`recallSimilarTurns` requires
 * `evalScore >= 0.7`); we promote eligible-by-outcome here and let
 * the read filter decide.
 *
 * Idempotency: `metadata.sendero_id = Booking.id`. The promote helper
 * diffs against existing ids; re-firing is safe.
 *
 * Auth: CRON_SECRET header match (Vercel injects this automatically).
 *
 * Spec: docs/specs/arize-phoenix-integration.md §6 PR4.
 */

import { type NextRequest, NextResponse } from 'next/server';

import { promoteSuccesses, type BookingRow } from '@sendero/arize-phoenix/promote';
import { prisma } from '@sendero/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const WINDOW_MS = 6 * 60 * 60 * 1000;
const ROW_LIMIT = 200;

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (expected && req.headers.get('authorization') !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const since = new Date(Date.now() - WINDOW_MS);
  const bookings = await prisma.booking.findMany({
    where: {
      status: 'confirmed',
      bookedAt: { gte: since },
    },
    select: {
      id: true,
      tenantId: true,
      kind: true,
      pnr: true,
      duffelOrderId: true,
      externalId: true,
      bookedAt: true,
      metadata: true,
      trip: { select: { id: true, metadata: true } },
    },
    orderBy: { bookedAt: 'desc' },
    take: ROW_LIMIT,
  });

  const rows: BookingRow[] = bookings.map(b => ({
    id: b.id,
    intent: deriveIntent(b),
    route: deriveRoute(b),
    tenantId: b.tenantId,
    traceId: deriveTraceId(b),
    bookingRef: b.pnr ?? b.duffelOrderId ?? b.externalId ?? null,
    confirmedAt: b.bookedAt,
  }));

  const report = await promoteSuccesses({ rows });

  return NextResponse.json({
    ok: report.available,
    windowSince: since.toISOString(),
    ...report,
  });
}

// ── derivation helpers ─────────────────────────────────────────────

interface BookingForDerivation {
  kind: string;
  metadata: unknown;
  trip: { metadata: unknown } | null;
}

function deriveIntent(b: BookingForDerivation): string {
  const tripMeta = readObject(b.trip?.metadata);
  const bookingMeta = readObject(b.metadata);
  const route = deriveRoute(b);
  const tripIntent = (tripMeta?.intent ?? bookingMeta?.intent) as string | undefined;
  if (typeof tripIntent === 'string' && tripIntent.length > 0) return tripIntent.slice(0, 200);
  return route ? `Book ${b.kind} ${route}` : `Book ${b.kind}`;
}

function deriveRoute(b: BookingForDerivation): string | null {
  const tripMeta = readObject(b.trip?.metadata);
  const bookingMeta = readObject(b.metadata);
  const direct = (tripMeta?.route ?? bookingMeta?.route) as string | undefined;
  if (typeof direct === 'string' && direct.length > 0) return direct.slice(0, 60);
  const origin = (tripMeta?.originIata ?? bookingMeta?.originIata) as string | undefined;
  const dest = (tripMeta?.destinationIata ?? bookingMeta?.destinationIata) as string | undefined;
  if (origin && dest) return `${origin}-${dest}`;
  return null;
}

function deriveTraceId(b: BookingForDerivation): string | null {
  const meta = readObject(b.metadata);
  const direct = meta?.traceId;
  return typeof direct === 'string' ? direct : null;
}

function readObject(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}
