/**
 * GET /api/cron/reconcile-gateway-transfers
 *
 * Phase 5 P5.4 — drains stuck Gateway transfers + reaps stale pending
 * sweeps every 10 minutes.
 *
 * Two passes per run:
 *   1. `findStuckTransfers` — rows in `attesting | minting` with a
 *      `circleTransferId` and `createdAt` older than `STUCK_MINUTES`.
 *      Each gets `hydrateTransferFromCircle`. Errors don't abort the
 *      batch — `Promise.allSettled` lets one bad row fail without
 *      torpedoing the rest.
 *   2. `reapStalePendingSweeps` — `GatewayDepositLog` rows pending
 *      past `STALE_SWEEP_MINUTES` flip to `failed` so the operator UI
 *      stops claiming "in flight" forever.
 *
 * Auth: CRON_SECRET via Authorization: Bearer header (Vercel injects
 * automatically; manual hits from `vercel env pull .env.local` need to
 * forge the header).
 *
 * Schedule: every 10 minutes (vercel.json). Bounded to 25 rows per run
 * so the cron always fits inside Vercel's 60s function budget even
 * when Circle is slow.
 */

import { type NextRequest, NextResponse } from 'next/server';
import {
  findStuckTransfers,
  hydrateTransferFromCircle,
  reapStalePendingSweeps,
} from '@sendero/circle/gateway-reconcile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Rows older than this in attesting/minting are candidates. 8 minutes
 *  avoids racing the synchronous EVM mint (which usually completes in
 *  seconds) and the Solana self-mint (which lands inside one slot). */
const STUCK_MINUTES = 8;

/** GatewayDepositLog pending past this flips to failed. 30 min is
 *  enough for the slowest webhook → confirmed flow under normal load. */
const STALE_SWEEP_MINUTES = 30;

const BATCH_SIZE = 25;

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (expected && req.headers.get('authorization') !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const stuck = await findStuckTransfers({
    stuckMinutes: STUCK_MINUTES,
    limit: BATCH_SIZE,
  });

  const reconcileSettlements = await Promise.allSettled(
    stuck.map(row => hydrateTransferFromCircle(row.id, row.circleTransferId))
  );

  const reconciled = reconcileSettlements.map((s, i) => {
    if (s.status === 'fulfilled') return s.value;
    return {
      logId: stuck[i].id,
      circleTransferId: stuck[i].circleTransferId,
      before: stuck[i].status,
      after: stuck[i].status,
      changed: false,
      error: s.reason instanceof Error ? s.reason.message : String(s.reason),
    };
  });

  const reaper = await reapStalePendingSweeps({ staleMinutes: STALE_SWEEP_MINUTES });

  const summary = {
    transfers: {
      scanned: stuck.length,
      changed: reconciled.filter(r => r.changed).length,
      confirmed: reconciled.filter(r => r.after === 'confirmed' && r.before !== 'confirmed').length,
      failed: reconciled.filter(r => r.after === 'failed' && r.before !== 'failed').length,
      errors: reconciled.filter(r => r.error).length,
    },
    sweeps: {
      scanned: reaper.scanned,
      reaped: reaper.reaped,
    },
  };

  console.log('[cron/reconcile-gateway-transfers] run complete', summary);

  return NextResponse.json({
    ok: true,
    ...summary,
    reconciled,
  });
}
