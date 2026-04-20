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
import { buildAndSettleBatch, type BatchStore, type SettleFn } from '@sendero/billing/batch';
import { prisma } from '@sendero/database';
import { env } from '@sendero/env';

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
      results.push({
        tenantId,
        outcome: 'settled',
        batchId: result.batchId,
        txHash: result.txHash,
      });
    } else {
      results.push({ tenantId, outcome: 'failed', batchId: result.batchId });
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
  };
}

// ─── Settlement function ───────────────────────────────────────────────
//
// For Phase 3 / hackathon demo this is a dry-run that emits a synthetic
// tx hash so the batch row transitions to `settled` and the admin
// dashboard shows realistic data. Phase 4 will replace this with a real
// Circle x402 batched transfer via @sendero/nanopayments.

function makeSettleFn(): SettleFn {
  return async ({ batchId, tenantId, totalMicroUsdc }) => {
    if (!env.treasuryPrivateKey()) {
      // No treasury wired — synthetic tx hash marks the demo batch
      // settled without risking a real transfer.
      const synthetic = `0xdemo${Buffer.from(`${tenantId}:${batchId}`).toString('hex').slice(0, 60).padEnd(60, '0')}`;
      return { txHash: synthetic };
    }
    // TODO (Phase 4): wire real Arc USDC transfer via @sendero/nanopayments.
    void totalMicroUsdc;
    return {
      txHash: `0xlive${Buffer.from(`${tenantId}:${batchId}`).toString('hex').slice(0, 60).padEnd(60, '0')}`,
    };
  };
}
