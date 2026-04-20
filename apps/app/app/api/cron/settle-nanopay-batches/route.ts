/**
 * Scheduled batch settlement.
 *
 * Runs hourly via Vercel Cron. For every tenant with unsettled paid
 * MeterEvents in the window, it builds a NanopayBatch and fires the
 * on-chain USDC transfer via @sendero/nanopayments.
 *
 * Auth: CRON_SECRET header match. Vercel injects this automatically
 * when the cron invokes the function; external callers are rejected.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { buildAndSettleBatch, retrySettlingBatches, type BatchStore, type SettleFn } from '@sendero/billing/batch';
import { prisma } from '@sendero/database';
import { transferUSDC } from '@sendero/nanopayments';
import { fireBatchFailedAlert } from '@sendero/slack';
import type { Address } from 'viem';
// `env` previously gated the synthetic vs live settle path; real transfer
// now owns its own env resolution inside @sendero/nanopayments.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (expected && req.headers.get('authorization') !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const store = makeBatchStore();
  const settle = makeSettleFn();

  // Find all tenants with any pending paid MeterEvents in the last day.
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

  const results: Array<{ tenantId: string; outcome: string; batchId?: string; txHash?: string }> =
    [];
  for (const { tenantId } of tenants) {
    if (!tenantId) continue;
    const result = await buildAndSettleBatch(store, settle, { tenantId });
    if (result.status === 'empty') {
      results.push({ tenantId, outcome: 'empty' });
    } else if (result.status === 'settled') {
      results.push({ tenantId, outcome: 'settled', batchId: result.batchId, txHash: result.txHash });
    } else if (result.status === 'retrying') {
      results.push({ tenantId, outcome: 'retrying', batchId: result.batchId });
    } else {
      // status === 'failed'
      await fireBatchFailedAlert({
        batchId: result.batchId,
        tenantId,
        totalMicroUsdc: result.totalMicroUsdc,
        retryCount: (result as { retryCount?: number }).retryCount ?? 3,
        error: result.error,
      });
      results.push({ tenantId, outcome: 'failed', batchId: result.batchId });
    }
  }

  const retries = await retrySettlingBatches(store, settle, { olderThanMs: 10 * 60 * 1000 });
  for (const r of retries) {
    if (r.status === 'settled') {
      results.push({ tenantId: r.tenantId, outcome: 'settled-on-retry', batchId: r.batchId, txHash: r.txHash });
    } else if (r.status === 'failed') {
      await fireBatchFailedAlert({
        batchId: r.batchId,
        tenantId: r.tenantId,
        totalMicroUsdc: r.totalMicroUsdc,
        retryCount: r.retryCount,
        error: r.error,
      });
      results.push({ tenantId: r.tenantId, outcome: 'failed-on-retry', batchId: r.batchId });
    } else {
      results.push({ tenantId: r.tenantId, outcome: 'retrying', batchId: r.batchId });
    }
  }

  return NextResponse.json({ ran: tenants.length, results });
}

// ─── Prisma-backed BatchStore ──────────────────────────────────────────

function makeBatchStore(): BatchStore {
  return {
    findClaimableEvents: async ({ tenantId, windowEndedAt, limit }) => {
      const events = await prisma.meterEvent.findMany({
        where: {
          tenantId,
          status: 'paid',
          settlementRef: null,
          at: { lte: windowEndedAt },
        },
        select: { id: true, priceMicroUsdc: true },
        orderBy: { at: 'asc' },
        take: limit,
      });
      return events;
    },

    openBatch: async args => {
      const row = await prisma.nanopayBatch.create({
        data: {
          tenantId: args.tenantId,
          status: 'pending',
          totalMicroUsdc: args.totalMicroUsdc,
          eventCount: args.eventCount,
          windowStartedAt: args.windowStartedAt,
          windowEndedAt: args.windowEndedAt,
        },
        select: { id: true },
      });
      return { id: row.id };
    },

    claimEventsForBatch: async ({ batchId, eventIds }) => {
      await prisma.meterEvent.updateMany({
        where: { id: { in: eventIds } },
        data: { settlementRef: batchId },
      });
    },

    updateBatchStatus: async args => {
      await prisma.nanopayBatch.update({
        where: { id: args.batchId },
        data: {
          status: args.status,
          txHash: args.txHash ?? undefined,
          error: args.error ?? undefined,
          settledAt: args.settledAt ?? undefined,
        },
      });
    },

    incrementRetry: async ({ batchId, lastError }) => {
      const row = await prisma.nanopayBatch.update({
        where: { id: batchId },
        data: {
          retryCount: { increment: 1 },
          lastError,
        },
        select: { retryCount: true },
      });
      return { retryCount: row.retryCount };
    },

    findSettlingBatches: async ({ olderThan, limit, maxRetryCount }) => {
      const rows = await prisma.nanopayBatch.findMany({
        where: {
          status: 'settling',
          updatedAt: { lte: olderThan },
          retryCount: { lt: maxRetryCount },
        },
        select: { id: true, tenantId: true, totalMicroUsdc: true, retryCount: true },
        orderBy: { updatedAt: 'asc' },
        take: limit,
      });
      return rows;
    },
  };
}

// ─── Settlement function ───────────────────────────────────────────────
//
// Real on-chain USDC transfer via @sendero/nanopayments. The treasury
// EOA is resolved inside transferUSDC; the destination address is the
// Sendero treasury receiving address (SENDERO_TREASURY_ADDRESS env).

function senderoTreasuryAddress(): Address {
  const a = process.env.SENDERO_TREASURY_ADDRESS;
  if (!a) throw new Error('SENDERO_TREASURY_ADDRESS not configured');
  return a as Address;
}

function makeSettleFn(): SettleFn {
  const to = senderoTreasuryAddress();
  return async ({ totalMicroUsdc, batchId, tenantId }) => {
    const amount = (Number(totalMicroUsdc) / 1e6).toFixed(6);
    const { txHash } = await transferUSDC({
      to,
      amount,
      label: `nanopay-batch:${tenantId}:${batchId}`,
    });
    return { txHash };
  };
}
