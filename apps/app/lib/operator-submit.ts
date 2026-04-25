/**
 * Operator-keyed on-chain submitter for SenderoGuestEscrow operator-only
 * functions (`setClaimCodeHash`, `cancelTrip`, `sweepUnspent`).
 *
 * The contract's operator address is the EOA whose private key lives in
 * `OPERATOR_PRIVATE_KEY` (env). At deploy time `ARC_OPERATOR` is set to
 * the public address derived from this key. Only that address can
 * call operator-gated methods on chain — see SenderoGuestEscrow.sol
 * `onlyOperator` modifier.
 *
 * Why a single operator helper closes two production blockers:
 *
 *   1. setClaimCodeHash rotation — fired when a guest requests an OTP
 *      resend. The contract's operator must sign because resend is a
 *      server-mediated flow (rate-limited, throttled, no end-user signing).
 *
 *   2. cancelTrip + sweepUnspent — the contract permits BOTH the trip's
 *      buyer AND the operator to call these. The cancel-sweep dashboard
 *      UI lets the buyer click a button; this helper signs on their
 *      behalf so we don't need a per-tenant passkey-WebAuthn flow on
 *      day one. (Sweep funds always return to `t.buyer` regardless of
 *      who calls — the contract enforces the recipient.)
 *
 * v2 enhancement (deferred): the buyer signs with their MSCA passkey
 * for true non-custodial cancel. The contract permits both paths today;
 * adding the passkey path is purely additive UX work, not a contract
 * change.
 *
 * Failure mode: if `OPERATOR_PRIVATE_KEY` is missing/malformed, the
 * factory throws synchronously so callers fail fast. If the on-chain
 * tx reverts (e.g. trip not in cancellable state), the helper surfaces
 * the viem ContractFunctionRevertedError with the contract's named error
 * so the route can map it to a clean status code.
 */

import { SENDERO_GUEST_ESCROW_ABI } from '@sendero/guest';
import {
  createWalletClient,
  http,
  type Address,
  type Hex,
  type WalletClient,
  type PublicClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getArcClient } from '@sendero/arc';

// ── Env resolution ───────────────────────────────────────────────────

function operatorPrivateKey(): Hex {
  const pk = process.env.OPERATOR_PRIVATE_KEY ?? process.env.ARC_OPERATOR_PRIVATE_KEY;
  if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    throw new Error(
      'OPERATOR_PRIVATE_KEY missing or malformed. Required to submit operator-gated escrow calls.',
    );
  }
  return pk as Hex;
}

function escrowAddress(): Address {
  const a =
    process.env.ARC_ESCROW_ADDRESS ??
    process.env.NEXT_PUBLIC_ARC_ESCROW_ADDRESS ??
    process.env.NEXT_PUBLIC_SENDERO_GUEST_ESCROW;
  if (!a || !/^0x[0-9a-fA-F]{40}$/.test(a)) {
    throw new Error(
      'ARC_ESCROW_ADDRESS missing or malformed. Required to address the SenderoGuestEscrow proxy.',
    );
  }
  return a as Address;
}

// ── Client cache ─────────────────────────────────────────────────────
//
// One viem WalletClient per process is fine — viem creates a new RPC
// transport per call internally; the client itself is just config. We
// cache to avoid re-deriving the account on every submit.

let cachedWallet: WalletClient | null = null;

function getOperatorWallet(): WalletClient {
  if (cachedWallet) return cachedWallet;
  const account = privateKeyToAccount(operatorPrivateKey());
  // Derive chain config from the existing public client so RPC URL +
  // chain id stay in sync. getArcClient already handles env lookup.
  const arcClient = getArcClient() as PublicClient;
  cachedWallet = createWalletClient({
    account,
    chain: arcClient.chain,
    transport: http(arcClient.transport.url),
  });
  return cachedWallet;
}

/** Reset the cached wallet — used by tests to force a re-read after env mutation. */
export function _resetOperatorWalletCache(): void {
  cachedWallet = null;
}

// ── Submit helpers ───────────────────────────────────────────────────

export type OperatorSubmitOutcome =
  | {
      ok: true;
      txHash: Hex;
      blockNumber: bigint;
      gasUsed: bigint;
    }
  | {
      ok: false;
      reason:
        | 'operator_key_unavailable'
        | 'escrow_unconfigured'
        | 'reverted'
        | 'rpc_error';
      message: string;
      /** Contract-level error name when reason === 'reverted'. */
      errorName?: string;
    };

// Back-compat aliases — existing callers import these names.
export type OperatorSubmitResult = Extract<OperatorSubmitOutcome, { ok: true }>;
export type OperatorSubmitError = Extract<OperatorSubmitOutcome, { ok: false }>;

/**
 * Submit `setClaimCodeHash(tripId, newCodeHash)` as the contract operator.
 * Used by the OTP resend route after generating + hashing a fresh preimage.
 *
 * Returns a structured result on both success and failure — never throws
 * for caller-recoverable reasons (env missing, contract revert). True
 * RPC connectivity errors propagate up so route handlers can decide
 * whether to retry.
 */
export async function submitSetClaimCodeHash(args: {
  onchainTripId: Hex;
  newCodeHash: Hex;
}): Promise<OperatorSubmitOutcome> {
  return submitOperatorWrite({
    functionName: 'setClaimCodeHash',
    args: [args.onchainTripId, args.newCodeHash],
  });
}

/**
 * Submit `cancelTrip(tripId)` as the contract operator. Acts on the
 * buyer's behalf — sweep recipient is still `t.buyer` per contract.
 * Used by the cancel-sweep dashboard server action.
 */
export async function submitCancelTrip(args: {
  onchainTripId: Hex;
}): Promise<OperatorSubmitOutcome> {
  return submitOperatorWrite({
    functionName: 'cancelTrip',
    args: [args.onchainTripId],
  });
}

/**
 * Submit `sweepUnspent(tripId)` as the contract operator. Returns
 * leftover budget to `t.buyer` (contract-enforced recipient).
 */
export async function submitSweepUnspent(args: {
  onchainTripId: Hex;
}): Promise<OperatorSubmitOutcome> {
  return submitOperatorWrite({
    functionName: 'sweepUnspent',
    args: [args.onchainTripId],
  });
}

// ── Internal — generic write + revert decoding ───────────────────────

interface WriteArgs {
  functionName: 'setClaimCodeHash' | 'cancelTrip' | 'sweepUnspent';
  args: readonly unknown[];
}

async function submitOperatorWrite(
  write: WriteArgs,
): Promise<OperatorSubmitOutcome> {
  let wallet: WalletClient;
  let escrow: Address;
  try {
    wallet = getOperatorWallet();
    escrow = escrowAddress();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      reason: message.includes('OPERATOR_PRIVATE_KEY')
        ? 'operator_key_unavailable'
        : 'escrow_unconfigured',
      message,
    };
  }

  const arcClient = getArcClient() as PublicClient;

  try {
    // Simulate first to catch contract reverts cleanly. viem's
    // writeContract WILL throw on reverts, but simulate gives us the
    // named error in the catch block which is more useful for routing.
    await arcClient.simulateContract({
      account: wallet.account,
      address: escrow,
      abi: SENDERO_GUEST_ESCROW_ABI,
      // viem's strict generic narrowing chokes on union literal here;
      // the runtime call path is ABI-safe via the abi entry above.
      functionName: write.functionName as 'cancelTrip',
      args: write.args as readonly [Hex],
    } as never);

    const txHash = (await wallet.writeContract({
      address: escrow,
      abi: SENDERO_GUEST_ESCROW_ABI,
      functionName: write.functionName as 'cancelTrip',
      args: write.args as readonly [Hex],
      // chain comes from the wallet client's config above — viem still
      // requires it on each writeContract call as a sanity check.
      chain: wallet.chain,
      account: wallet.account!,
    } as never)) as Hex;

    const receipt = await arcClient.waitForTransactionReceipt({ hash: txHash });
    return {
      ok: true,
      txHash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed,
    };
  } catch (err) {
    const errorName = extractContractErrorName(err);
    if (errorName) {
      return {
        ok: false,
        reason: 'reverted',
        message: `${write.functionName} reverted with ${errorName}`,
        errorName,
      };
    }
    return {
      ok: false,
      reason: 'rpc_error',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Pull the contract-level error name out of a viem error chain. viem
 * 2.x wraps reverts in `ContractFunctionRevertedError` with a `data`
 * field that carries the decoded `errorName` when the ABI is provided
 * to the call site (which we do via SENDERO_GUEST_ESCROW_ABI).
 *
 * Returns null when the error isn't a contract revert (RPC failure,
 * timeout, etc) so the caller can route appropriately.
 */
function extractContractErrorName(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null;
  // viem nests the actual revert under .cause (sometimes deeply).
  // Walk the chain once — typical depth is 1-2.
  let cur: unknown = err;
  for (let i = 0; i < 5 && cur; i++) {
    const obj = cur as Record<string, unknown>;
    const data = obj.data as Record<string, unknown> | undefined;
    if (data && typeof data === 'object' && typeof data.errorName === 'string') {
      return data.errorName;
    }
    if (typeof obj.errorName === 'string') return obj.errorName;
    cur = obj.cause;
  }
  return null;
}
