/**
 * Self-healing traveler DCW → Gateway sweep.
 *
 * Circle's `transactions.inbound` webhook is the canonical trigger for
 * sweeping USDC from a traveler's DCW into their unified Gateway pool.
 * In practice the webhook misses fire for two reasons:
 *
 *   1. Direct transfers (faucet drips, user wallet sends) sometimes
 *      land at a Circle-derived SCA address that Circle's notification
 *      pipeline didn't subscribe to for that specific (walletId,
 *      chain). The DCW is real, the funds are real, but the webhook
 *      never fires.
 *   2. Webhook delivery failures, dev/ngrok flapping, signature
 *      mismatches — none of which the demo can tolerate.
 *
 * This helper is the durable fix. Call it before any balance read or
 * booking-payment check; it reads raw on-chain balances for every
 * EVM Gateway chain the traveler has a DCW on, sweeps anything above
 * `MIN_SWEEP_MICRO_USDC`, and lets the Circle webhook stay as a
 * latency optimization rather than a correctness requirement.
 *
 * Idempotency: `depositTravelerToGateway` writes to GatewayDepositLog
 * keyed on a deterministic webhookEventId derived from
 * `manual-sweep:<userId>:<chainKey>:<txCount>` so a double-call in the
 * same minute coalesces. Failures are fail-soft per chain.
 *
 * Cost: one `eth_call balanceOf(address)` per EVM chain configured in
 * `GATEWAY_CHAINS`. ~150ms on each RPC. We fan out in parallel, so the
 * total p99 is governed by the slowest chain.
 */

import { createPublicClient, erc20Abi, http } from 'viem';

import { prisma } from '@sendero/database';

import { depositTravelerToGateway } from './gateway-deposit-traveler';
import { GATEWAY_CHAINS } from './gateway';
import type { GatewayChainKey } from './unified-gateway';

/** Don't sweep dust. 0.10 USDC is enough to cover gas + audit overhead. */
const MIN_SWEEP_MICRO_USDC = 100_000n; // 0.10 USDC

export interface AutoSweepResult {
  swept: Array<{
    chainKey: GatewayChainKey;
    address: string;
    amount: string;
    depositTxHash?: string;
    depositLogId?: string;
  }>;
  skipped: Array<{
    chainKey: GatewayChainKey;
    address: string;
    reason: string;
  }>;
}

export interface AutoSweepArgs {
  userId: string;
  tenantId: string;
  /** Override the minimum sweep amount (in micro-USDC). Useful for tests. */
  minMicroUsdc?: bigint;
  /** Per-chain RPC timeout in ms. Default 2500. */
  timeoutMs?: number;
}

/**
 * Sweep any stranded USDC at the traveler's EVM DCWs into their
 * unified Gateway pool. Returns a per-chain breakdown of what moved.
 */
export async function autoSweepStrandedTravelerBalances(
  args: AutoSweepArgs
): Promise<AutoSweepResult> {
  const min = args.minMicroUsdc ?? MIN_SWEEP_MICRO_USDC;
  const timeoutMs = args.timeoutMs ?? 2500;

  const wallets = await prisma.wallet.findMany({
    where: { userId: args.userId, provisioner: 'dcw' },
    select: { address: true, chainId: true, metadata: true },
  });
  if (wallets.length === 0) return { swept: [], skipped: [] };

  const result: AutoSweepResult = { swept: [], skipped: [] };

  // Match wallets to GATEWAY_CHAINS by chainId (EVM) or by metadata.chainKey (fallback).
  const sweepable: Array<{
    chainKey: GatewayChainKey;
    chain: (typeof GATEWAY_CHAINS)[GatewayChainKey];
    address: string;
  }> = [];

  for (const w of wallets) {
    for (const [key, def] of Object.entries(GATEWAY_CHAINS) as Array<
      [GatewayChainKey, (typeof GATEWAY_CHAINS)[GatewayChainKey]]
    >) {
      if (def.kind !== 'evm') continue;
      const viemChain = (def as { viemChain?: { id: number } }).viemChain;
      if (!viemChain) continue;
      if (viemChain.id !== w.chainId) continue;
      sweepable.push({ chainKey: key, chain: def, address: w.address });
      break;
    }
  }

  // Fan out per-chain balance reads in parallel; sweep each one independently.
  await Promise.all(
    sweepable.map(async ({ chainKey, chain, address }) => {
      try {
        const client = createPublicClient({
          // viemChain is asserted above via the chainKey filter
          chain: (chain as { viemChain: import('viem').Chain }).viemChain,
          transport: http((chain as { rpcUrl: string }).rpcUrl, { timeout: timeoutMs }),
        });
        // viem 2.x readContract signature has a tighter overload that
        // expects authorizationList. Cast via unknown — the abi is a
        // const so the call shape is correct at runtime; the type
        // narrowing is the issue.
        const rawBalance = (await (
          client.readContract as unknown as (args: unknown) => Promise<bigint>
        )({
          address: (chain as { usdc: `0x${string}` }).usdc,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [address as `0x${string}`],
        })) as bigint;

        if (rawBalance < min) {
          result.skipped.push({
            chainKey,
            address,
            reason: `dust (${rawBalance} micro-USDC < ${min})`,
          });
          return;
        }

        // Human-readable amount string for the deposit API.
        const whole = rawBalance / 1_000_000n;
        const frac = rawBalance % 1_000_000n;
        const amount = `${whole}.${frac.toString().padStart(6, '0')}`;

        // Deterministic idempotency per (user, chain, balance window).
        // Round to the nearest 30s window so duplicate triggers within
        // the same balance-check cycle collapse to one row, but a
        // fresh deposit landing later still gets a fresh row.
        const windowSec = Math.floor(Date.now() / 30000);
        const idempotencyKey = `auto-sweep:${args.userId}:${chainKey}:${windowSec}`;

        const sweep = await depositTravelerToGateway({
          userId: args.userId,
          tenantId: args.tenantId,
          chainKey,
          dcwAddress: address,
          amount,
          amountBaseUnits: rawBalance,
          triggeredBy: 'manual',
          webhookEventId: idempotencyKey,
        });

        if (sweep.status === 'confirmed') {
          result.swept.push({
            chainKey,
            address,
            amount,
            depositTxHash: sweep.depositTxHash,
            depositLogId: sweep.depositLogId,
          });
        } else if (sweep.status === 'already-processed') {
          result.skipped.push({ chainKey, address, reason: 'already-processed' });
        } else {
          result.skipped.push({
            chainKey,
            address,
            reason: `sweep_failed:${sweep.status === 'failed' ? sweep.error : sweep.status}`,
          });
        }
      } catch (err) {
        result.skipped.push({
          chainKey,
          address,
          reason: `chain_error:${err instanceof Error ? err.message : String(err)}`,
        });
      }
    })
  );

  return result;
}
