/**
 * Traveler-side Gateway deposit via Unified Balance Kit.
 *
 * Mirror of `gateway-sweep::depositSolanaOpsToGateway` / the EVM tenant
 * deposit path, but for the TRAVELER's Circle DCW: when USDC lands at
 * the traveler's DCW (Circle webhook fires `transactions.inbound`), we
 * push it into the user's Gateway unified balance using
 * `kit.deposit({ from: { adapter, chain, address: dcwAddress } })`.
 *
 * Source of truth for the API: Circle's Unified Balance Kit + the
 * Circle Wallets adapter. We do NOT hand-roll EIP-3009 here — Circle
 * signs via the adapter, internally resolving the DCW address to the
 * matching Circle wallet UUID. Same proven path tenants use for ops
 * DCW sweeps (see `gateway-sweep.ts:411`).
 *
 * Idempotent on `webhookEventId` via `GatewayDepositLog.webhookEventId`
 * unique index — Circle's at-least-once delivery + dual CONFIRMED /
 * COMPLETED firing collapses to one deposit.
 */

import { UnifiedBalanceKit } from '@circle-fin/unified-balance-kit';
import { createCircleWalletsAdapter } from '@circle-fin/adapter-circle-wallets';

import { prisma } from '@sendero/database';
import { env } from '@sendero/env';

import { GATEWAY_CHAINS, isEvmChain } from './gateway';

export interface DepositTravelerToGatewayArgs {
  /** Sendero User.id whose DCW received the USDC. Used for audit + log. */
  userId: string;
  /** Tenant context — log row needs a tenantId; resolve from User.metadata.primaryTenantId. */
  tenantId: string;
  /** Source chain key (e.g. 'Arc_Testnet', 'Base_Sepolia'). Must exist in GATEWAY_CHAINS. */
  chainKey: keyof typeof GATEWAY_CHAINS;
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

function unifiedBalanceChainName(chainKey: keyof typeof GATEWAY_CHAINS): string {
  if (chainKey === 'Sol_Devnet') return 'Solana_Devnet';
  if (chainKey === 'Sol') return 'Solana';
  return GATEWAY_CHAINS[chainKey].kitName;
}

export async function depositTravelerToGateway(
  args: DepositTravelerToGatewayArgs
): Promise<DepositTravelerToGatewayResult> {
  const { userId, tenantId, chainKey, dcwAddress, amount, amountBaseUnits, triggeredBy = 'auto', webhookEventId } = args;

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

  // Idempotency check before any work.
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

  // Insert the pending log row. `tenantId` is required on
  // GatewayDepositLog; pass through the user's primary tenant. `userId`
  // sits in `metadata` (no schema change needed in this commit).
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

  const apiKey = env.circleApiKey();
  const entitySecret = env.circleEntitySecret();
  if (!apiKey || !entitySecret) {
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
    const adapter = createCircleWalletsAdapter({ apiKey, entitySecret });
    const kit = new UnifiedBalanceKit();

    // Plain `deposit()` — caller (the user's DCW) is both the depositor
    // and the recipient of the unified balance. `depositFor` is for
    // delegate flows where Sendero treasury credits the user's balance
    // from its own funds; that's not this path.
    const result = await kit.deposit({
      from: {
        adapter,
        chain: unifiedBalanceChainName(chainKey),
        address: dcwAddress,
      },
      amount,
      token: 'USDC',
    } as never);

    const depositTxHash = (result as { txHash?: string }).txHash;
    if (!depositTxHash) {
      throw new Error('Unified Balance kit.deposit returned no txHash');
    }

    await prisma.gatewayDepositLog.update({
      where: { id: logRow.id },
      data: {
        status: 'confirmed',
        depositTxHash,
        confirmedAt: new Date(),
      },
    });

    console.log('[gateway-deposit-traveler] confirmed', {
      userId,
      dcwAddress,
      chainKey,
      amount,
      depositTxHash,
      depositLogId: logRow.id,
    });

    return {
      status: 'confirmed',
      depositLogId: logRow.id,
      depositTxHash,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.gatewayDepositLog.update({
      where: { id: logRow.id },
      data: { status: 'failed', errorMessage: message.slice(0, 500) },
    });
    return {
      status: 'failed',
      depositLogId: logRow.id,
      error: message,
    };
  }
}
