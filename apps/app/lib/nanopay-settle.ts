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
import { requirePlatformTreasuryDestination } from '@/lib/platform-treasury';

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
    const destination = await requirePlatformTreasuryDestination('arc', 'nanopay-settle');
    const to = destination.address as Address;
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
 * Phase 6.x.y — Solana settle path. Per-tenant Solana DCWs landed in
 * Phase 4.x.y; this fn debits the tenant's SOL-DEVNET treasury via
 * Circle's `createTransaction` API, sending USDC SPL to the Sendero
 * Solana treasury address.
 *
 * Async settlement contract: Circle's DCW `createTransaction` returns
 * a Circle internal `transactionId` immediately with state='INITIATED'.
 * The on-chain confirmation lands later via Circle's webhook. We
 * persist the Circle txId as `provisioningTxRef` (treated as the
 * batch's txHash for audit purposes); downstream readers can resolve
 * the on-chain Solana sig via `getTransaction(txId)` when needed.
 *
 * The retrySettlingBatches age-based reconciler already handles
 * status='settling' rows that haven't confirmed within 10min — same
 * mechanism Arc uses. No Sol-specific cron logic needed; the existing
 * batch lifecycle works as-is.
 */
export function makeSolanaSettleFn(): SettleFn {
  return async ({ totalMicroUsdc, tenantId }) => {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { primaryChain: true },
    });
    if (tenant?.primaryChain !== 'sol') {
      throw new Error(
        `[nanopay-settle:sol] tenant ${tenantId} primaryChain is '${tenant?.primaryChain}' — expected 'sol'.`
      );
    }

    const treasury = await prisma.circleWallet.findFirst({
      where: {
        tenantId,
        kind: 'treasury',
        chain: { in: ['SOL-DEVNET', 'SOL'] },
      },
      select: { circleWalletId: true, chain: true, address: true },
    });
    if (!treasury?.circleWalletId) {
      throw new Error(
        `[nanopay-settle:sol] tenant ${tenantId} has no Solana treasury CircleWallet (Phase 4.x.y provisioning hasn't run).`
      );
    }

    const senderoSolTreasury = await requirePlatformTreasuryDestination(
      'sol',
      'nanopay-settle:sol'
    );

    const tokenId =
      treasury.chain === 'SOL'
        ? process.env.CIRCLE_USDC_SOL_TOKEN_ID
        : process.env.CIRCLE_USDC_SOL_DEVNET_TOKEN_ID;
    if (!tokenId) {
      throw new Error(
        `[nanopay-settle:sol] CIRCLE_USDC_${treasury.chain === 'SOL' ? '' : 'SOL_DEVNET_'}TOKEN_ID not set.`
      );
    }

    // Lazy-import @sendero/circle so this lib doesn't pull in the
    // Circle DCW SDK on Arc-only flows.
    const { getCircle } = await import('@sendero/circle/wallets');
    const circle = getCircle();

    const amount = microUsdcToDecimal(totalMicroUsdc);
    const response = await circle.createTransaction({
      walletId: treasury.circleWalletId,
      tokenId,
      destinationAddress: senderoSolTreasury.address,
      amount: [amount],
      fee: { type: 'level', config: { feeLevel: 'MEDIUM' as never } },
      refId: `nanopay-${tenantId}-${Date.now()}`,
    } as never);

    const transactionId = (response.data as { id?: string } | undefined)?.id ?? '';
    if (!transactionId) {
      throw new Error(
        `[nanopay-settle:sol] Circle createTransaction returned no transactionId for tenant ${tenantId}.`
      );
    }

    // Echo the Circle txId as txHash. The reconciler webhook (Circle
    // event monitor) resolves it to the on-chain Solana signature on
    // confirmation. Until then the row sits at status='settling';
    // retrySettlingBatches handles age-based reconciliation.
    return { txHash: transactionId };
  };
}

/**
 * Phase 6.x — caller-side filter for the cron candidate scan.
 *
 * Phase 6.x.y note: Sol tenants are no longer filtered out here.
 * The cron now routes each tenant through their primaryChain's
 * settle fn (`makeSettleFn` for arc, `makeSolanaSettleFn` for sol).
 *
 * This helper stays exported in case future flows need to pre-filter
 * by chain — but the current cron uses `tenantPrimaryChainMap`
 * below, which returns chain per id rather than a binary include set.
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

/**
 * Phase 6.x.y — return a per-tenant chain map so the cron can route
 * each candidate through the correct settle fn. Replaces the binary
 * "is eligible for arc" filter with a chain-aware dispatch.
 */
export async function tenantPrimaryChainMap(
  candidateTenantIds: string[]
): Promise<Map<string, 'arc' | 'sol'>> {
  if (candidateTenantIds.length === 0) return new Map();
  const rows = await prisma.tenant.findMany({
    where: { id: { in: candidateTenantIds } },
    select: { id: true, primaryChain: true },
  });
  return new Map(rows.map(r => [r.id, r.primaryChain]));
}
