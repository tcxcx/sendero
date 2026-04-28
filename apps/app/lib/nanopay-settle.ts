/**
 * Shared nanopay settlement helpers.
 *
 * Used by:
 *   - `/api/cron/settle-nanopay-batches` — daily cron sweep + retry of
 *     stuck `settling` batches.
 *   - `/api/chat` `onFinish` — inline per-turn settle (one `transferUSDC`
 *     fires right after the meter row is written) so Spend / Arcscan
 *     reflect the call within seconds.
 *
 * Inline + cron are belt-and-suspenders: if `transferUSDC` flakes during
 * the inline pass, the event stays at `settlementRef: null` and the
 * cron picks it up next run. No event ever falls between the cracks.
 *
 * `transferUSDC` is the same EOA path the cron uses — `TREASURY_PRIVATE_KEY`
 * → Arc USDC contract → `SENDERO_TREASURY_ADDRESS`. No passkey, no MSCA.
 */

import { type BatchStore, type SettleFn } from '@sendero/billing/batch';
import { prisma } from '@sendero/database';
import { transferUSDC } from '@sendero/nanopayments';
import type { Address } from 'viem';

export function senderoTreasuryAddress(): Address {
  const a = process.env.SENDERO_TREASURY_ADDRESS;
  if (!a) throw new Error('SENDERO_TREASURY_ADDRESS not configured');
  return a as Address;
}

export function makeBatchStore(): BatchStore {
  return {
    findClaimableEvents: async ({ tenantId, windowEndedAt, limit }) => {
      return prisma.meterEvent.findMany({
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
      return prisma.nanopayBatch.findMany({
        where: {
          status: 'settling',
          updatedAt: { lte: olderThan },
          retryCount: { lt: maxRetryCount },
        },
        select: { id: true, tenantId: true, totalMicroUsdc: true, retryCount: true },
        orderBy: { updatedAt: 'asc' },
        take: limit,
      });
    },
  };
}

/**
 * The actual on-chain transfer. Real EOA → Arc USDC → treasury.
 * Throws on RPC / signing / balance failures; the caller decides
 * whether the failure is fatal (cron) or fire-and-forget (inline).
 */
export function makeSettleFn(): SettleFn {
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
