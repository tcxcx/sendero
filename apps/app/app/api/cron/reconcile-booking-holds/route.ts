/**
 * GET /api/cron/reconcile-booking-holds
 *
 * Sweeper for stuck Booking-reconciliation. Background:
 *
 *   - executeTransferSpend (apps/app/lib/transfer-spend/execute.ts:183)
 *     calls reconcileBookingAfterSpend fire-and-forget after the
 *     on-chain spend settles. If that promise throws OR the process is
 *     killed mid-flight, the TransferAttempt is stamped 'executed' but
 *     the Booking stays 'pending' forever.
 *
 *   - reconcileBookingAfterSpend itself fails closed on transient DB
 *     errors (Neon serverless cold-start, conn pool exhaustion).
 *
 * This route finds those stuck pairs and re-runs the reconciler. The
 * conditional updateMany inside reconcileBookingAfterSpend guarantees
 * idempotency — re-running on a row that already moved is a noop.
 *
 * Selection logic:
 *   1. TransferAttempt rows where status='executed' AND attempt is
 *      older than 5 minutes (inline reconcile should have fired and
 *      either succeeded or thrown by then).
 *   2. metadata.bookingId is set (this attempt was settling a
 *      specific booking, not a tenant-prefund deposit or a generic
 *      spend).
 *   3. The matching Booking is still 'pending' (the reconcile flip
 *      hasn't landed yet).
 *
 * Bounded to 50 candidates per run to stay inside Vercel's
 * `maxDuration` budget. Scheduled every 10 minutes via vercel.json.
 *
 * Auth: CRON_SECRET header match (Vercel injects this automatically).
 */

import { type NextRequest, NextResponse } from 'next/server';
import { prisma } from '@sendero/database';

import { reconcileBookingAfterSpend } from '@/lib/booking-reconcile/reconcile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const STUCK_AFTER_MS = 5 * 60 * 1000;
const BATCH_LIMIT = 50;

interface SweepResult {
  attemptId: string;
  bookingId: string;
  outcome: 'reconciled' | 'noop' | 'failed';
  reason?: string;
}

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (expected && req.headers.get('authorization') !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - STUCK_AFTER_MS);

  // Pull executed TransferAttempts that look like booking settlements
  // (metadata.bookingId set). Older-than-cutoff so we don't fight the
  // inline reconciler that fires synchronously after a successful spend.
  const candidates = await prisma.transferAttempt.findMany({
    where: {
      status: 'executed',
      updatedAt: { lt: cutoff },
      metadata: { path: ['bookingId'], not: null as unknown as undefined },
    },
    orderBy: { updatedAt: 'asc' },
    take: BATCH_LIMIT,
    select: {
      id: true,
      tenantId: true,
      txHash: true,
      metadata: true,
    },
  });

  const results: SweepResult[] = [];
  for (const c of candidates) {
    const meta = (c.metadata && typeof c.metadata === 'object'
      ? (c.metadata as Record<string, unknown>)
      : {}) as Record<string, unknown>;
    const bookingId = typeof meta.bookingId === 'string' ? meta.bookingId : null;
    if (!bookingId) continue;

    // Cheap pre-check — skip rows where the Booking already moved out
    // of 'pending'. Avoids paying the reconciler's notification cost
    // for a row we know is a noop.
    const pending = await prisma.booking.findFirst({
      where: { id: bookingId, tenantId: c.tenantId, status: 'pending' },
      select: { id: true },
    });
    if (!pending) {
      results.push({ attemptId: c.id, bookingId, outcome: 'noop', reason: 'not_pending' });
      continue;
    }

    try {
      const r = await reconcileBookingAfterSpend({
        tenantId: c.tenantId,
        bookingId,
        attemptId: c.id,
        txHash: c.txHash,
      });
      results.push({
        attemptId: c.id,
        bookingId,
        outcome: r.kind === 'reconciled' ? 'reconciled' : r.kind === 'noop' ? 'noop' : 'failed',
        reason: r.kind !== 'reconciled' ? ('reason' in r ? r.reason : r.message) : undefined,
      });
    } catch (err) {
      results.push({
        attemptId: c.id,
        bookingId,
        outcome: 'failed',
        reason: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
      });
    }
  }

  const summary = {
    reconciled: results.filter(r => r.outcome === 'reconciled').length,
    noop: results.filter(r => r.outcome === 'noop').length,
    failed: results.filter(r => r.outcome === 'failed').length,
  };

  return NextResponse.json({
    candidateCount: candidates.length,
    summary,
    results,
  });
}
