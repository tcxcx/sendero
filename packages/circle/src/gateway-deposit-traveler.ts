/**
 * Traveler-side Gateway deposit.
 *
 * Thin shim over `gateway-deposit-core.ts::depositTravelerToGatewayUnified`.
 * Kept under the original filename + signature so existing call sites
 * (Circle webhook handler, sweep tools, auto-sweep helper) don't have
 * to change. ALL deposit semantics live in the core. If you find
 * yourself adding logic here, you're drifting — push it into the
 * core instead.
 */

import { depositTravelerToGatewayUnified } from './gateway-deposit-core';
import { type GatewayChainKey } from './unified-gateway';

export interface DepositTravelerToGatewayArgs {
  userId: string;
  tenantId: string;
  chainKey: GatewayChainKey;
  dcwAddress: string;
  amount: string;
  amountBaseUnits: bigint;
  triggeredBy?: 'auto' | 'manual' | 'cron';
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
  const result = await depositTravelerToGatewayUnified({
    tenantId: args.tenantId,
    userId: args.userId,
    dcwAddress: args.dcwAddress,
    chainKey: args.chainKey,
    amount: args.amount,
    amountBaseUnits: args.amountBaseUnits,
    triggeredBy: args.triggeredBy,
    webhookEventId: args.webhookEventId,
  });

  // Narrow the core's discriminated union back to the legacy shape so
  // call sites that destructure { status, depositLogId, depositTxHash }
  // keep working without touching them.
  if (result.status === 'confirmed') {
    return {
      status: 'confirmed',
      depositLogId: result.depositLogId,
      depositTxHash: result.depositTxHash,
    };
  }
  if (result.status === 'already-processed') {
    return {
      status: 'already-processed',
      depositLogId: result.depositLogId,
      depositTxHash: result.depositTxHash,
    };
  }
  if (result.status === 'failed') {
    return {
      status: 'failed',
      depositLogId: result.depositLogId ?? '',
      error: result.error,
    };
  }
  // 'skipped' from the core (zero-amount / unknown chain) — surface as
  // failed for legacy callers, with the skip reason in the error.
  return {
    status: 'failed',
    depositLogId: '',
    error: `skipped: ${result.reason}`,
  };
}
