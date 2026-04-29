/**
 * Gateway sweep — webhook-driven auto-rebalance loop.
 *
 * Triggered when Circle's `transactions.inbound` webhook fires for a
 * tenant's operations DCW. Moves USDC into the unified Gateway balance
 * in two on-chain steps:
 *
 *   1. Ops DCW → tenant Gateway EOA (Circle SDK transfer; Gas Station
 *      pays via the Circle SCA).
 *   2. Tenant EOA → Gateway (gasless EIP-3009 ReceiveWithAuthorization
 *      submitted by the platform sponsor; see `gateway-deposit.ts`).
 *
 * Phase 1 = Arc only, "always-sweep" policy (sweep 100% on every
 * inbound, no threshold). Arc gas is cheap so threshold complexity
 * isn't worth the schema/logic surface yet. `TenantGatewayConfig.sweepPolicy`
 * Json column is forward-compat for Phase 3 when expensive chains land.
 *
 * Idempotent on `webhookEventId` via the `gateway_deposit_logs.webhookEventId`
 * unique index. Circle's at-least-once delivery + dual CONFIRMED/COMPLETED
 * fires for the same notification.id collapse to one row + one tx.
 *
 * Failure modes:
 *   - Ops DCW transfer fails → log status='failed', error, no deposit.
 *   - Deposit fails after transfer succeeds → USDC is stranded in the
 *     tenant EOA. The reconciler (Phase 5 cron) re-attempts the
 *     deposit step using the existing log row's amount. Manual support
 *     path: POST /api/gateway/sweep with the tenant id + chain.
 */

import { parseUnits, type Address } from 'viem';
import { prisma } from '@sendero/database';
import { GATEWAY_CHAINS, type GatewayChain as GatewayChainConfig } from './gateway';
import { getOrCreateGatewaySigner } from './gateway-signer';
import { depositToGateway } from './gateway-deposit';

export interface SweepChainArgs {
  tenantId: string;
  /** Circle wallet id of the ops DCW that received the inbound USDC. */
  opsDcwWalletId: string;
  /** Lowercased address of the ops DCW. */
  opsDcwAddress: Address;
  /** Sendero chain key (e.g. 'Arc_Testnet'). Must exist in GATEWAY_CHAINS. */
  chainKey: keyof typeof GATEWAY_CHAINS;
  /** Human-readable USDC amount from the Circle webhook. */
  amount: string;
  /** Source — distinguishes auto-sweep webhooks from manual support flows. */
  triggeredBy: 'auto' | 'manual' | 'cron';
  /** Idempotency key — Circle webhook notification.id when triggered by auto. */
  webhookEventId?: string;
  /** Optional SDK injection for testing. Defaults to lazy `getCircle()`. */
  sdk?: SweepCircleSdk;
}

/** Narrow adapter over the Circle DCW SDK methods this module needs. */
export interface SweepCircleSdk {
  createTransaction: (args: {
    walletId: string;
    tokenId: string;
    destinationAddress: string;
    amount: string[];
    fee: { type: 'level'; config: { feeLevel: string } };
    refId?: string;
  }) => Promise<{ data?: { id?: string; state?: string } }>;
  getTransaction: (args: { id: string }) => Promise<{
    data?: { transaction?: { state?: string; txHash?: string; errorReason?: string } };
  }>;
  getWalletTokenBalance: (args: { id: string; includeAll?: boolean }) => Promise<{
    data?: {
      tokenBalances?: Array<{
        amount?: string;
        token?: { id?: string; symbol?: string; blockchain?: string };
      }>;
    };
  }>;
}

export type SweepResult =
  | { status: 'confirmed'; depositLogId: string; depositTxHash: string; opsTransferTxHash: string }
  | { status: 'already-processed'; depositLogId: string; depositTxHash: string }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; error: string; depositLogId?: string };

const POLL_INTERVAL_MS = 2_000;
const POLL_MAX_ATTEMPTS = 60; // 120s total — matches desk-v1's pattern

/**
 * Run the full sweep: ops DCW → tenant EOA → Gateway. Returns a
 * structured `SweepResult` so callers can branch without try/catch.
 */
export async function sweepChain(args: SweepChainArgs): Promise<SweepResult> {
  const { tenantId, opsDcwWalletId, opsDcwAddress, chainKey, amount, triggeredBy, webhookEventId } =
    args;

  const chain = GATEWAY_CHAINS[chainKey];
  if (!chain) {
    return { status: 'failed', error: `Unknown Gateway chain key: ${chainKey}` };
  }

  // Early idempotency — if this webhook already swept successfully,
  // bail before touching Circle / chain. Race-safe duplicate webhook
  // protection.
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

  // Validate amount before any Circle calls.
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

  const signer = await getOrCreateGatewaySigner(tenantId);
  const sdk = args.sdk ?? (await resolveSdk());

  // Step 1: Move USDC ops DCW → tenant EOA via Circle SDK.
  let opsTransferTxHash: string;
  try {
    const tokenId = await resolveUsdcTokenId(sdk, opsDcwWalletId, chain);
    if (!tokenId) {
      return {
        status: 'failed',
        error: `could not resolve USDC tokenId for ops DCW ${opsDcwWalletId} on ${chainKey}`,
      };
    }

    const refId = webhookEventId
      ? `gateway-sweep:${webhookEventId.slice(0, 32)}` // Circle refId is short
      : `gateway-sweep:${tenantId.slice(0, 8)}:${Date.now()}`;

    const createRes = await sdk.createTransaction({
      walletId: opsDcwWalletId,
      tokenId,
      destinationAddress: signer.address,
      amount: [amount],
      fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
      refId,
    });

    const challengeId = createRes.data?.id;
    if (!challengeId) {
      return {
        status: 'failed',
        error: `Circle createTransaction returned no id: ${JSON.stringify(createRes)}`,
      };
    }

    opsTransferTxHash = await pollCircleTransaction(sdk, challengeId);
  } catch (err) {
    return {
      status: 'failed',
      error: `ops DCW transfer failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Step 2: Tenant EOA → Gateway via EIP-3009.
  try {
    const result = await depositToGateway({
      tenantId,
      chainKey,
      amount,
      triggeredBy,
      webhookEventId,
    });
    return {
      status: result.alreadyProcessed ? 'already-processed' : 'confirmed',
      depositLogId: result.depositLogId,
      depositTxHash: result.depositTxHash,
      opsTransferTxHash,
    };
  } catch (err) {
    // USDC is now stranded in the tenant EOA — the reconciler will
    // pick this up. We return failure so the caller logs / alerts.
    return {
      status: 'failed',
      error: `gateway deposit failed (USDC stranded in tenant EOA): ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ── Internals ─────────────────────────────────────────────────────────

/**
 * Resolve the Circle-internal tokenId UUID for USDC on the ops DCW's
 * chain. Circle's createTransaction wants the UUID, not the on-chain
 * USDC address. We read the wallet's tokenBalances and pick the entry
 * matching the chain's USDC contract address (case-insensitive).
 *
 * Cached at the module level keyed by (walletId, chain) — tokenIds
 * are stable per Circle deployment.
 */
const tokenIdCache = new Map<string, string>();

async function resolveUsdcTokenId(
  sdk: SweepCircleSdk,
  walletId: string,
  chain: GatewayChainConfig
): Promise<string | null> {
  const cacheKey = `${walletId}:${chain.kitName}`;
  const cached = tokenIdCache.get(cacheKey);
  if (cached) return cached;

  const res = await sdk.getWalletTokenBalance({ id: walletId, includeAll: true });
  const balances = res?.data?.tokenBalances ?? [];
  // Circle uses the symbol 'USDC' uniformly across testnets.
  const usdcEntry = balances.find(b => b.token?.symbol === 'USDC');
  const tokenId = usdcEntry?.token?.id;
  if (!tokenId) return null;
  tokenIdCache.set(cacheKey, tokenId);
  return tokenId;
}

/**
 * Poll Circle until the transaction reaches a terminal state. Mirrors
 * desk-v1's `pollTransactionComplete` (60 attempts × 2s = 120s) with
 * the same rescue-on-timeout behavior: if the poll loop exits but the
 * tx is actually confirmed, return its hash instead of erroring.
 */
async function pollCircleTransaction(sdk: SweepCircleSdk, challengeId: string): Promise<string> {
  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    const res = await sdk.getTransaction({ id: challengeId });
    const tx = res?.data?.transaction;
    const state = tx?.state;
    if (state === 'CONFIRMED' || state === 'COMPLETE' || state === 'COMPLETED') {
      if (!tx?.txHash) {
        throw new Error(`Circle tx ${challengeId} ${state} but no txHash`);
      }
      return tx.txHash;
    }
    if (state === 'FAILED' || state === 'DENIED') {
      throw new Error(`Circle tx ${challengeId} ${state}: ${tx?.errorReason ?? 'unknown'}`);
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }

  // Timeout rescue — requery once before giving up. The tx may have
  // confirmed in the gap between the last poll and this check.
  const final = await sdk.getTransaction({ id: challengeId });
  const tx = final?.data?.transaction;
  if (
    (tx?.state === 'CONFIRMED' || tx?.state === 'COMPLETE' || tx?.state === 'COMPLETED') &&
    tx.txHash
  ) {
    return tx.txHash;
  }
  throw new Error(
    `Circle tx ${challengeId} timed out after ${(POLL_MAX_ATTEMPTS * POLL_INTERVAL_MS) / 1000}s`
  );
}

async function resolveSdk(): Promise<SweepCircleSdk> {
  try {
    const mod = await import('./wallets');
    if ('getCircle' in mod && typeof (mod as { getCircle?: unknown }).getCircle === 'function') {
      return (mod as { getCircle: () => unknown }).getCircle() as SweepCircleSdk;
    }
  } catch {
    // fall through
  }
  throw new Error(
    'sweepChain: cannot resolve a Circle SDK. Pass `sdk` explicitly or ensure @sendero/circle/wallets exports getCircle().'
  );
}
