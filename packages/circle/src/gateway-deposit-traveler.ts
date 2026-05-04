/**
 * Traveler-side Gateway deposit.
 *
 * Thin orchestrator: when USDC lands at the traveler's Circle DCW
 * (Circle webhook fires `transactions.inbound`), push it into the
 * user's Gateway unified balance. All SDK contact points — the kit
 * instance, the Circle Wallets adapter, the chain-name mapping —
 * live in `@sendero/circle/unified-gateway`. This file owns the
 * audit log + idempotency surface only.
 *
 * Idempotent on `webhookEventId` via `GatewayDepositLog.webhookEventId`
 * unique index — Circle's at-least-once delivery + dual CONFIRMED /
 * COMPLETED firing collapses to one deposit.
 */

import { prisma } from '@sendero/database';

import { GATEWAY_CHAINS, isEvmChain } from './gateway';
import {
  circleWalletsPrincipal,
  deposit as unifiedDeposit,
  type GatewayChainKey,
} from './unified-gateway';

export interface DepositTravelerToGatewayArgs {
  /** Sendero User.id whose DCW received the USDC. Used for audit + log. */
  userId: string;
  /** Tenant context — log row needs a tenantId; resolve from User.metadata.primaryTenantId. */
  tenantId: string;
  /** Source chain key (e.g. 'Arc_Testnet', 'Base_Sepolia'). Must exist in GATEWAY_CHAINS. */
  chainKey: GatewayChainKey;
  /** Traveler's Circle DCW EVM address (depositor + recipient). */
  dcwAddress: string;
  /** Human-readable USDC amount (e.g. "10" for 10 USDC). */
  amount: string;
  /** Amount in base units (10^6 USDC) for the audit log row. */
  amountBaseUnits: bigint;
  /** auto (webhook-triggered) | manual (recovery script) | cron (reaper). */
  triggeredBy?: 'auto' | 'manual' | 'cron';
  /** Idempotency key — Circle webhook notification.id when triggered by auto-sweep. */
  webhookEventId?: string;
}

export interface DepositTravelerToGatewayResult {
  status: 'confirmed' | 'already-processed' | 'failed';
  depositLogId: string;
  depositTxHash?: string;
  error?: string;
}

export async function depositTravelerToGateway(
  args: DepositTravelerToGatewayArgs
): Promise<DepositTravelerToGatewayResult> {
  const {
    userId,
    tenantId,
    chainKey,
    dcwAddress,
    amount,
    amountBaseUnits,
    triggeredBy = 'auto',
    webhookEventId,
  } = args;

  const chain = GATEWAY_CHAINS[chainKey];
  if (!chain) {
    return { status: 'failed', depositLogId: '', error: `Unknown Gateway chain: ${chainKey}` };
  }
  if (!isEvmChain(chain)) {
    return {
      status: 'failed',
      depositLogId: '',
      error: `depositTravelerToGateway: ${chainKey} is a Solana chain — Solana traveler deposits go through gateway-sweep's Solana path.`,
    };
  }

  if (webhookEventId) {
    const existing = await prisma.gatewayDepositLog.findUnique({
      where: { webhookEventId },
    });
    if (existing?.status === 'confirmed' && existing.depositTxHash) {
      return {
        status: 'already-processed',
        depositLogId: existing.id,
        depositTxHash: existing.depositTxHash,
      };
    }
  }

  const logRow = await prisma.gatewayDepositLog.upsert({
    where: webhookEventId ? { webhookEventId } : { id: '00000000-0000-0000-0000-000000000000' },
    create: {
      tenantId,
      chain: chain.kitName,
      domain: chain.domain,
      amountMicroUsdc: amountBaseUnits,
      status: 'pending',
      triggeredBy,
      webhookEventId: webhookEventId ?? null,
    },
    update: {},
  });

  const principal = circleWalletsPrincipal({
    address: dcwAddress,
    label: `traveler:${userId}:${chainKey}`,
  });
  if (!principal) {
    await prisma.gatewayDepositLog.update({
      where: { id: logRow.id },
      data: { status: 'failed', errorMessage: 'circle_wallets_adapter_not_configured' },
    });
    return {
      status: 'failed',
      depositLogId: logRow.id,
      error: 'circle_wallets_adapter_not_configured',
    };
  }

  try {
    const { txHash: depositTxHash } = await unifiedDeposit({
      principal,
      chainKey,
      amount,
    });

    await prisma.gatewayDepositLog.update({
      where: { id: logRow.id },
      data: { status: 'confirmed', depositTxHash, confirmedAt: new Date() },
    });

    console.log('[gateway-deposit-traveler] confirmed', {
      userId,
      dcwAddress,
      chainKey,
      amount,
      depositTxHash,
      depositLogId: logRow.id,
    });

    return { status: 'confirmed', depositLogId: logRow.id, depositTxHash };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.gatewayDepositLog.update({
      where: { id: logRow.id },
      data: { status: 'failed', errorMessage: message.slice(0, 500) },
    });
    return { status: 'failed', depositLogId: logRow.id, error: message };
  }
}
