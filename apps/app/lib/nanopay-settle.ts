/**
 * Shared nanopay settlement helpers.
 *
 * Used by:
 *   - `/api/cron/settle-nanopay-batches` — cron sweep + retry of
 *     stuck `settling` batches.
 *
 * The settlement source is the tenant's Gateway unified balance. That
 * makes usage billing draw from the same operating balance that receives
 * deposits and ticket-sale profit, instead of charging the platform
 * treasury EOA for customer activity.
 */

import type { BatchStore, SettleFn } from '@sendero/billing/batch';
import { GATEWAY_CHAINS } from '@sendero/circle/gateway';
import { spendTenantUnifiedUsd } from '@sendero/circle/unified-balance';
import { prisma } from '@sendero/database';
import type { Address } from 'viem';

import { microUsdcToDecimal } from '@/lib/gateway-balance-math';

export function senderoTreasuryAddress(): Address {
  const a = process.env.SENDERO_TREASURY_ADDRESS;
  if (!a) throw new Error('SENDERO_TREASURY_ADDRESS not configured');
  return a as Address;
}

function domainForAllocationChain(chainName: string | undefined): number | null {
  if (!chainName) return null;
  const normalized =
    chainName === 'Solana_Devnet' ? 'Sol_Devnet' : chainName === 'Solana' ? 'Sol' : chainName;
  const chain = Object.values(GATEWAY_CHAINS).find(c => c.kitName === normalized);
  return chain?.domain ?? null;
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
 * The actual on-chain transfer. Tenant Gateway unified balance →
 * Sendero treasury on Arc. Throws on Gateway / signing / balance
 * failures; the batch caller records retry state.
 *
 * Phase 6.x — defensive read of `tenant.primaryChain`. Solana-primary
 * tenants must NOT reach this path; the cron's candidate scan filters
 * them out (see findArcSettleCandidates below). If one slips through
 * (race, manual call, future bug), throw with a clear message rather
 * than silently routing Sol-tenant funds through the Arc Gateway.
 */
export function makeSettleFn(): SettleFn {
  const to = senderoTreasuryAddress();
  return async ({ totalMicroUsdc, tenantId }) => {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { primaryChain: true },
    });
    if (tenant?.primaryChain === 'sol') {
      throw new Error(
        `[nanopay-settle] tenant ${tenantId} is Solana-primary; settle pipeline must use makeSolanaSettleFn (Phase 6.x.y).`
      );
    }
    const amount = microUsdcToDecimal(totalMicroUsdc);
    const toChain = GATEWAY_CHAINS.Arc_Testnet;
    const log = await prisma.gatewayTransferLog.create({
      data: {
        tenantId,
        sourceDomain: null,
        destinationDomain: toChain.domain,
        destinationChain: toChain.kitName,
        amountMicroUsdc: totalMicroUsdc,
        recipientAddress: to.toLowerCase(),
        status: 'attesting',
        forwardingEnabled: false,
        triggeredBy: 'nanopay_batch',
      },
      select: { id: true },
    });

    try {
      const result = await spendTenantUnifiedUsd({
        tenantId,
        amount,
        destinationChain: 'Arc_Testnet',
        recipient: to,
      });
      await prisma.gatewayTransferLog.update({
        where: { id: log.id },
        data: {
          sourceDomain: domainForAllocationChain(result.allocations?.[0]?.chain as string),
          mintTxHash: result.txHash,
          status: 'confirmed',
          confirmedAt: new Date(),
        },
      });
      return { txHash: result.txHash };
    } catch (err) {
      await prisma.gatewayTransferLog
        .update({
          where: { id: log.id },
          data: {
            status: 'failed',
            errorMessage: err instanceof Error ? err.message : String(err),
          },
        })
        .catch(() => undefined);
      throw err;
    }
  };
}

/**
 * Phase 6.x.y — Solana settle path (placeholder).
 *
 * The Arc settler debits the tenant's Gateway unified balance; the
 * Solana counterpart needs a per-tenant Solana wallet AND a Solana
 * Sendero treasury address. Per-tenant Solana wallets land in
 * Phase 3.x; once they exist, this helper:
 *   1. Reads `tenant.primaryChain === 'sol'` (defensive).
 *   2. Loads the tenant's Solana DCW / Squads vault.
 *   3. Calls `transferUSDCByChain({ chain: 'sol', to: solTreasury,
 *      amount, ... })` from `@sendero/nanopayments/router`.
 *   4. Returns `{ txHash: <solana sig> }`.
 *
 * Today it throws — the cron filter excludes Sol tenants from the
 * candidate scan, so this is reachable only via direct call. The
 * throw makes that obvious instead of silently producing the wrong
 * result.
 */
export function makeSolanaSettleFn(): SettleFn {
  return async ({ tenantId }) => {
    throw new Error(
      `[nanopay-settle] Solana settle path is Phase 6.x.y; tenant ${tenantId} cannot settle until per-tenant Solana wallets are provisioned (Phase 3.x).`
    );
  };
}

/**
 * Phase 6.x — caller-side filter for the cron candidate scan.
 *
 * Returns the subset of tenant ids that should run through the Arc
 * settle pipeline today. Solana-primary tenants are excluded so
 * their MeterEvent rows don't keep queueing batches that would
 * either fail loudly (defensive throw above) or settle to the wrong
 * chain. Their events accumulate harmlessly in `meter_events`
 * pending Phase 6.x.y.
 *
 * Pure helper — single Prisma read, returned as a Set for O(1)
 * membership checks at the cron layer.
 */
export async function arcSettleEligibleTenantIds(
  candidateTenantIds: string[]
): Promise<Set<string>> {
  if (candidateTenantIds.length === 0) return new Set();
  const rows = await prisma.tenant.findMany({
    where: {
      id: { in: candidateTenantIds },
      primaryChain: 'arc',
    },
    select: { id: true },
  });
  return new Set(rows.map(r => r.id));
}
