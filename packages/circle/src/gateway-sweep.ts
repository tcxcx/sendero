/**
 * Tenant-side Gateway sweep — thin shim over the unified
 * `gateway-deposit-core::depositTenantToGateway`. All deposit
 * semantics (idempotency, depositFor vs deposit, log lifecycle) live
 * in the core so tenant + traveler can't drift apart again.
 *
 * History: this file used to carry its own ~200-line copy of the
 * deposit logic. Travelers had a separate fork that silently no-op'd
 * on every deposit because it self-deposited instead of using
 * depositFor. One implementation → one place to fix → no more drift.
 */

import { parseUnits } from 'viem';

import { depositTenantToGateway } from './gateway-deposit-core';
import { GATEWAY_CHAINS } from './gateway';

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

export async function sweepChain(args: SweepChainArgs): Promise<SweepResult> {
  // Parse the amount once here (the only tenant-side concern) so the
  // core takes pre-validated base units. Same try/catch shape as
  // before so existing callers see "invalid amount" verbatim.
  let amountBaseUnits: bigint;
  try {
    amountBaseUnits = parseUnits(args.amount, 6);
  } catch (err) {
    return {
      status: 'failed',
      error: `invalid amount: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const result = await depositTenantToGateway({
    tenantId: args.tenantId,
    dcwAddress: args.opsDcwAddress,
    chainKey: args.chainKey,
    amount: args.amount,
    amountBaseUnits,
    triggeredBy: args.triggeredBy,
    webhookEventId: args.webhookEventId,
  });

  // Translate the core's discriminated union to the legacy
  // SweepResult shape. The only legacy-specific field is
  // `opsTransferTxHash` (back-compat with the pre-migration two-tx
  // flow); we surface the deposit hash on both fields.
  if (result.status === 'confirmed') {
    return {
      status: 'confirmed',
      depositLogId: result.depositLogId,
      depositTxHash: result.depositTxHash,
      opsTransferTxHash: result.depositTxHash,
    };
  }
  if (result.status === 'already-processed') {
    return {
      status: 'already-processed',
      depositLogId: result.depositLogId,
      depositTxHash: result.depositTxHash,
    };
  }
  if (result.status === 'skipped') {
    return { status: 'skipped', reason: result.reason };
  }
  return { status: 'failed', error: result.error, depositLogId: result.depositLogId };
}
