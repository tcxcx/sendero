/**
 * Gateway sweep — webhook-driven auto-rebalance loop.
 *
 * When Circle's `transactions.inbound` webhook fires for a tenant's
 * operations / treasury DCW, push the USDC into Gateway in ONE step
 * via `unifiedGateway.deposit({ principal: circleWalletsPrincipal })`.
 * The DCW IS the Gateway depositor — same architecture as the
 * traveler path (see `gateway-deposit-traveler.ts`).
 *
 * History: this used to be a 2-step path (DCW → tenant EOA via Circle
 * SDK → Gateway via EIP-3009 ReceiveWithAuthorization sponsored by the
 * platform treasury). That path stranded USDC at the EOA when the
 * EIP-3009 step hung — the user observed "in-flight then stranded"
 * during dogfood. The single-step DCW→Gateway path is the proven
 * traveler flow and removes the entire stranding surface.
 *
 * Idempotent on `webhookEventId` via the `gateway_deposit_logs.webhookEventId`
 * unique index. Circle's at-least-once delivery + dual CONFIRMED/COMPLETED
 * fires for the same notification.id collapse to one row + one tx.
 *
 * Failure modes:
 *   - Circle creds missing → failed log row, never strands funds.
 *   - SDK error during deposit → failed log row with error message;
 *     funds remain at the DCW (Circle-managed, recoverable).
 */

import { Prisma, prisma } from '@sendero/database';
import { parseUnits } from 'viem';

import { GATEWAY_CHAINS, isEvmChain } from './gateway';
import {
  circleWalletsPrincipal,
  deposit as unifiedDeposit,
  depositFor as unifiedDepositFor,
} from './unified-gateway';

export interface SweepChainArgs {
  tenantId: string;
  /** Circle wallet id of the ops/treasury DCW that received the inbound USDC. */
  opsDcwWalletId: string;
  /** Address of the DCW. EVM is 0x-prefixed; Solana is base58. */
  opsDcwAddress: string;
  /** Sendero chain key (e.g. 'Arc_Testnet'). Must exist in GATEWAY_CHAINS. */
  chainKey: keyof typeof GATEWAY_CHAINS;
  /** Human-readable USDC amount from the Circle webhook. */
  amount: string;
  /** Source — distinguishes auto-sweep webhooks from manual support flows. */
  triggeredBy: 'auto' | 'manual' | 'cron';
  /** Idempotency key — Circle webhook notification.id when triggered by auto. */
  webhookEventId?: string;
}

export type SweepResult =
  | { status: 'confirmed'; depositLogId: string; depositTxHash: string; opsTransferTxHash: string }
  | { status: 'already-processed'; depositLogId: string; depositTxHash: string }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; error: string; depositLogId?: string };

/**
 * Single-step DCW → Gateway deposit. Same path for EVM and Solana
 * because `unifiedGateway.deposit` handles chain-name normalization
 * internally. Returns a structured `SweepResult` so callers can
 * branch without try/catch.
 */
export async function sweepChain(args: SweepChainArgs): Promise<SweepResult> {
  const { tenantId, opsDcwAddress, chainKey, amount, triggeredBy, webhookEventId } = args;

  const chain = GATEWAY_CHAINS[chainKey];
  if (!chain) {
    return { status: 'failed', error: `Unknown Gateway chain key: ${chainKey}` };
  }

  // Early idempotency.
  if (webhookEventId) {
    const existing = await prisma.gatewayDepositLog.findUnique({
      where: { webhookEventId },
    });
    if (existing && existing.status === 'confirmed' && existing.depositTxHash) {
      return {
        status: 'already-processed',
        depositLogId: existing.id,
        depositTxHash: existing.depositTxHash,
      };
    }
  }

  let amountBaseUnits: bigint;
  try {
    amountBaseUnits = parseUnits(amount, 6);
  } catch (err) {
    return {
      status: 'failed',
      error: `invalid amount: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (amountBaseUnits <= 0n) {
    return { status: 'skipped', reason: 'zero or negative amount' };
  }

  // Claim the idempotency row. On unique-constraint collision, fall
  // back to the existing row (typical Circle dual-fire of CONFIRMED +
  // COMPLETED for the same notification.id).
  let log;
  if (webhookEventId) {
    try {
      log = await prisma.gatewayDepositLog.create({
        data: {
          tenantId,
          chain: chain.kitName,
          domain: chain.domain,
          amountMicroUsdc: amountBaseUnits,
          status: 'pending',
          triggeredBy,
          webhookEventId,
        },
      });
    } catch (err) {
      if (!isUniqueConstraint(err)) {
        return {
          status: 'failed',
          error: `failed to claim sweep idempotency key: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
      const existing = await prisma.gatewayDepositLog.findUnique({ where: { webhookEventId } });
      if (existing?.status === 'confirmed' && existing.depositTxHash) {
        return {
          status: 'already-processed',
          depositLogId: existing.id,
          depositTxHash: existing.depositTxHash,
        };
      }
      return {
        status: 'skipped',
        reason: `gateway sweep ${existing?.status ?? 'unknown'} for webhook ${webhookEventId}`,
      };
    }
  } else {
    log = await prisma.gatewayDepositLog.create({
      data: {
        tenantId,
        chain: chain.kitName,
        domain: chain.domain,
        amountMicroUsdc: amountBaseUnits,
        status: 'pending',
        triggeredBy,
      },
    });
  }

  const principal = circleWalletsPrincipal({
    address: opsDcwAddress,
    label: `ops:${tenantId}:${chainKey}`,
  });
  if (!principal) {
    await prisma.gatewayDepositLog.update({
      where: { id: log.id },
      data: { status: 'failed', errorMessage: 'circle_wallets_adapter_not_configured' },
    });
    return {
      status: 'failed',
      depositLogId: log.id,
      error: 'circle_wallets_adapter_not_configured',
    };
  }

  // Resolve the tenant's Gateway depositor of record. Tenants use the
  // per-tenant gateway-signer EOA as the depositor (the address every
  // dashboard, balance query, and explorer link points at). The DCW
  // signs and pays the on-chain deposit, but the EOA is credited on
  // Gateway — that's `depositFor`. Travelers don't have a separate
  // depositor row, so they fall through to self-deposit (`deposit()`)
  // and the DCW IS their depositor.
  const config = await prisma.tenantGatewayConfig.findUnique({
    where: { tenantId },
    select: { evmDepositorAddress: true },
  });
  const useDepositFor =
    isEvmChain(chain) &&
    config?.evmDepositorAddress &&
    config.evmDepositorAddress.toLowerCase() !== opsDcwAddress.toLowerCase();

  try {
    console.log('[gateway-sweep] dispatching deposit', {
      tenantId,
      chainKey,
      opsDcwAddress,
      depositMode: useDepositFor ? 'depositFor' : 'deposit',
      depositAccount: useDepositFor ? config?.evmDepositorAddress : opsDcwAddress,
      amount,
    });
    const { txHash: depositTxHash } = useDepositFor
      ? await unifiedDepositFor({
          principal,
          chainKey,
          amount,
          depositAccount: config!.evmDepositorAddress,
        })
      : await unifiedDeposit({
          principal,
          chainKey,
          amount,
        });

    await prisma.gatewayDepositLog.update({
      where: { id: log.id },
      data: { status: 'confirmed', depositTxHash, confirmedAt: new Date() },
    });
    return {
      status: 'confirmed',
      depositLogId: log.id,
      depositTxHash,
      // Pre-migration this was a separate hash for the DCW→EOA hop.
      // Now there's one tx; surface it on both fields for back-compat.
      opsTransferTxHash: depositTxHash,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.gatewayDepositLog.update({
      where: { id: log.id },
      data: { status: 'failed', errorMessage: message.slice(0, 500) },
    });
    return { status: 'failed', depositLogId: log.id, error: message };
  }
}

function isUniqueConstraint(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return err.code === 'P2002';
  }
  const message = err instanceof Error ? err.message : String(err);
  return message.includes('P2002') || message.toLowerCase().includes('unique');
}
