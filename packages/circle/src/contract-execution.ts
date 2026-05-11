/**
 * Circle Developer-Controlled Wallets — contract execution wrapper.
 *
 * Submits an arbitrary contract call from a Circle DCW. Used by the
 * server-side guest claim flow: after we provision the traveler's DCW
 * via `ensureTravelerWallet`, the server signs the Peanut-style claim
 * proof and calls `escrow.claimTrip(...)` FROM the DCW. The DCW is the
 * `msg.sender`, the escrow contract verifies the recovered signer
 * against `trip.claimPubKey20`, and USDC lands in the DCW.
 *
 * Why this is a small wrapper and not Circle's full transaction API:
 * we only need the contract-execution shape for the guest claim, and
 * Circle's API surface returns a `transactionId` that needs polling
 * to get the final `txHash`. Bundling polling here keeps every caller
 * (Arc claim, future Sol claim, future settlement contract execs)
 * from re-implementing the same wait loop.
 *
 * Gas: Circle Gas Station sponsors EVM DCW gas on every supported
 * testnet/mainnet chain. No native token required on the DCW for EVM
 * calls. Solana DCWs need lamports — that's handled by `ensureSolanaGas`
 * in `./unified-gateway`, not here.
 */

import { getCircle } from './wallets';

/**
 * Map a `chainId` integer (EIP-155 for EVM) to Circle's blockchain
 * identifier (`ARC-TESTNET`, `BASE-SEPOLIA`, …) — Circle's API doesn't
 * take chainId directly. Add new chains here as we expand.
 *
 * Sol uses a different code path (not chainId-based); this map is
 * EVM-only.
 */
export const EVM_CHAIN_ID_TO_CIRCLE: Record<number, string> = {
  5042002: 'ARC-TESTNET', // Arc Testnet
  11155111: 'ETH-SEPOLIA',
  84532: 'BASE-SEPOLIA',
  43113: 'AVAX-FUJI',
  421614: 'ARB-SEPOLIA',
  11155420: 'OP-SEPOLIA',
  80002: 'MATIC-AMOY',
};

export interface ContractExecutionArgs {
  /** Circle wallet id of the DCW that will sign + send the tx. */
  walletId: string;
  /** Target contract address (e.g. the SenderoGuestEscrow). */
  contractAddress: string;
  /** Raw 0x-prefixed hex calldata. */
  callData: string;
  /** Optional native-token value to send with the call. */
  value?: string;
  /** Idempotency key — Circle requires UUID v4. */
  idempotencyKey: string;
  /** Polling timeout in ms. Default 60s. */
  timeoutMs?: number;
  /** Polling interval in ms. Default 1.5s. */
  pollIntervalMs?: number;
}

export interface ContractExecutionResult {
  /** Circle's internal transaction id. */
  transactionId: string;
  /** On-chain tx hash, once the transaction reaches `CONFIRMED`. */
  txHash: string;
  /** Final Circle state — usually `'CONFIRMED'`. */
  state: string;
}

/**
 * Submit a contract call from a Circle DCW and wait for confirmation.
 *
 * Throws when:
 *   - Circle returns no transactionId (SDK shape change)
 *   - Polling timeout elapses before state ∈ {`CONFIRMED`, `COMPLETE`}
 *   - Final state is `FAILED` / `CANCELLED` (surfaces Circle's error)
 *
 * On success, returns the txHash for downstream receipt assertions
 * (e.g. checking the Transfer log on Arc for the claimed USDC).
 */
export async function executeContractCallFromDcw(
  args: ContractExecutionArgs
): Promise<ContractExecutionResult> {
  const circle = getCircle();
  const timeoutMs = args.timeoutMs ?? 60_000;
  const pollIntervalMs = args.pollIntervalMs ?? 1_500;

  const createRes = await circle.createContractExecutionTransaction({
    walletId: args.walletId,
    contractAddress: args.contractAddress,
    callData: args.callData,
    ...(args.value ? { amount: [args.value] } : {}),
    idempotencyKey: args.idempotencyKey,
    fee: {
      type: 'level',
      // biome-ignore lint/suspicious/noExplicitAny: Circle SDK enum is loose
      config: { feeLevel: 'MEDIUM' as any },
    },
    // biome-ignore lint/suspicious/noExplicitAny: SDK accepts looser shape than its public type
  } as any);

  const transactionId = (createRes.data as { id?: string })?.id;
  if (!transactionId) {
    throw new Error('contract-execution: Circle returned no transactionId — SDK shape changed?');
  }

  // Poll for confirmation. Circle's createTransaction is async; the
  // returned record starts in INITIATED and progresses through
  // QUEUED → SENT → CONFIRMED. We block here so callers can act on the
  // final txHash deterministically.
  const deadline = Date.now() + timeoutMs;
  let lastState = 'INITIATED';
  while (Date.now() < deadline) {
    const txRes = await circle.getTransaction({ id: transactionId });
    const tx = txRes.data as {
      state?: string;
      txHash?: string;
      errorReason?: string;
    };
    lastState = tx.state ?? lastState;
    if (lastState === 'CONFIRMED' || lastState === 'COMPLETE') {
      if (!tx.txHash) {
        throw new Error(
          `contract-execution: state=${lastState} but no txHash returned (tx=${transactionId})`
        );
      }
      return { transactionId, txHash: tx.txHash, state: lastState };
    }
    if (lastState === 'FAILED' || lastState === 'CANCELLED' || lastState === 'DENIED') {
      throw new Error(
        `contract-execution: tx ${transactionId} reached terminal state ${lastState}${
          tx.errorReason ? `: ${tx.errorReason}` : ''
        }`
      );
    }
    await new Promise(r => setTimeout(r, pollIntervalMs));
  }

  throw new Error(
    `contract-execution: timed out after ${timeoutMs}ms waiting for tx ${transactionId} (last state: ${lastState})`
  );
}
