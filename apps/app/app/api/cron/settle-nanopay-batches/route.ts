/**
 * Scheduled batch settlement — every 5 minutes via Vercel Cron.
 *
 * For every tenant with unsettled paid MeterEvents, builds a
 * NanopayBatch and debits the tenant's Gateway Business Balance into
 * Sendero treasury.
 *
 * Cheap-when-idle: a fast pre-flight count returns immediately when
 * there are no pending events AND no stuck `settling` batches to
 * retry. Vercel Pro's included function quota covers ~8.6k cron
 * invocations/month at this cadence even without the early return,
 * but the guard keeps actual compute proportional to real work.
 *
 * Auth: CRON_SECRET header match. Vercel injects this automatically
 * when the cron invokes the function; external callers are rejected.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { buildAndSettleBatch, retrySettlingBatches } from '@sendero/billing/batch';
import { prisma } from '@sendero/database';
import { fireBatchFailedAlert } from '@sendero/slack';

import {
  makeBatchStore,
  makeSettleFn,
  makeSolanaSettleFn,
  tenantPrimaryChainMap,
} from '@/lib/nanopay-settle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (expected && req.headers.get('authorization') !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Cheap pre-flight — skip the whole settle path when there's
  // nothing to do. Two parallel counts: any pending events at all,
  // and any `settling` batches eligible for retry. Either being
  // non-zero kicks off the real work.
  const RETRY_AGE_MS = 10 * 60 * 1000;
  const retryCutoff = new Date(Date.now() - RETRY_AGE_MS);
  const [pendingEventCount, retryableBatchCount] = await Promise.all([
    prisma.meterEvent.count({
      where: { status: 'paid', settlementRef: null, tenantId: { not: null } },
    }),
    prisma.nanopayBatch.count({
      where: {
        status: 'settling',
        updatedAt: { lte: retryCutoff },
        retryCount: { lt: 3 },
      },
    }),
  ]);

  if (pendingEventCount === 0 && retryableBatchCount === 0) {
    return NextResponse.json({
      ran: 0,
      skipped: 'no_pending_events',
      pendingEventCount,
      retryableBatchCount,
    });
  }

  const store = makeBatchStore();
  const arcSettle = makeSettleFn();
  const solSettle = makeSolanaSettleFn();

  // Find all tenants with any pending paid MeterEvents.
  const tenants = await prisma.meterEvent.findMany({
    where: {
      status: 'paid',
      settlementRef: null,
      tenantId: { not: null },
    },
    select: { tenantId: true },
    distinct: ['tenantId'],
    take: 500,
  });

  // Phase 6.x.y — chain-aware dispatch. Each tenant routes through
  // their primaryChain's settle fn. Sol tenants debit their per-tenant
  // SOL-DEVNET DCW (Phase 4.x.y) via Circle's createTransaction; Arc
  // tenants stay on the Gateway unified-balance path.
  const candidateIds = tenants
    .map(t => t.tenantId)
    .filter((id): id is string => Boolean(id));
  const chainMap = await tenantPrimaryChainMap(candidateIds);

  const results: Array<{
    tenantId: string;
    chain: 'arc' | 'sol' | 'unknown';
    outcome: string;
    batchId?: string;
    txHash?: string;
  }> = [];
  for (const { tenantId } of tenants) {
    if (!tenantId) continue;
    const chain = chainMap.get(tenantId);
    if (!chain) {
      results.push({ tenantId, chain: 'unknown', outcome: 'skipped_unknown_chain' });
      continue;
    }
    const settle = chain === 'sol' ? solSettle : arcSettle;
    const result = await buildAndSettleBatch(store, settle, { tenantId });
    if (result.status === 'empty') {
      results.push({ tenantId, chain, outcome: 'empty' });
    } else if (result.status === 'settled') {
      results.push({
        tenantId,
        chain,
        outcome: 'settled',
        batchId: result.batchId,
        txHash: result.txHash,
      });
    } else if (result.status === 'retrying') {
      results.push({ tenantId, chain, outcome: 'retrying', batchId: result.batchId });
    } else {
      // status === 'failed'
      await fireBatchFailedAlert({
        batchId: result.batchId,
        tenantId,
        totalMicroUsdc: result.totalMicroUsdc,
        retryCount: (result as { retryCount?: number }).retryCount ?? 3,
        error: result.error,
      });
      results.push({ tenantId, chain, outcome: 'failed', batchId: result.batchId });
    }
  }

  // Retries dispatch by chain too — load each batch's tenant chain
  // and route to the matching settle fn. Default to arc when unknown
  // (legacy batches predate the chain field).
  const retryStoreSettle: typeof arcSettle = async params => {
    const chain = chainMap.get(params.tenantId) ?? 'arc';
    return chain === 'sol' ? solSettle(params) : arcSettle(params);
  };
  const retries = await retrySettlingBatches(store, retryStoreSettle, {
    olderThanMs: 10 * 60 * 1000,
  });
  for (const r of retries) {
    const chain = chainMap.get(r.tenantId) ?? 'unknown';
    if (r.status === 'settled') {
      results.push({
        tenantId: r.tenantId,
        chain,
        outcome: 'settled-on-retry',
        batchId: r.batchId,
        txHash: r.txHash,
      });
    } else if (r.status === 'failed') {
      await fireBatchFailedAlert({
        batchId: r.batchId,
        tenantId: r.tenantId,
        totalMicroUsdc: r.totalMicroUsdc,
        retryCount: r.retryCount,
        error: r.error,
      });
      results.push({
        tenantId: r.tenantId,
        chain,
        outcome: 'failed-on-retry',
        batchId: r.batchId,
      });
    } else {
      results.push({
        tenantId: r.tenantId,
        chain,
        outcome: 'retrying',
        batchId: r.batchId,
      });
    }
  }

  return NextResponse.json({ ran: tenants.length, results });
}
