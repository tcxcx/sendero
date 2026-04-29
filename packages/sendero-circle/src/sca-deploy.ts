/**
 * Circle SCA on-chain deployment helper.
 *
 * Circle DCW SCAs (`circle_6900_singleowner_v3`) are counterfactual
 * until their first OUTBOUND transaction. `signTypedData` rejects
 * with "undeployed wallet" until then. Inbound transfers do NOT
 * trigger deployment — only outbound does.
 *
 * Phase 2 makes this matter: when ops DCWs are first provisioned on
 * a new chain, they're counterfactual. The auto-sweep loop's first
 * outbound transfer (ops DCW → tenant Gateway EOA) triggers
 * deployment as a side effect. But operator-initiated flows
 * (manual deposit, balance refresh) may want to know the wallet is
 * deployable before relying on it.
 *
 * Strategy:
 *   1. Cache-first: read `circle_wallets.scaDeployedAt`. If non-null,
 *      return `already-deployed` with zero Circle calls.
 *   2. Read `accountType` via `getWallet`. If EOA, return immediately.
 *   3. List recent transactions. If any OUTBOUND CONFIRMED/COMPLETE
 *      exists, stamp the cache and return `already-deployed`.
 *   4. Otherwise submit a self-send 0 native (Circle Gas Station pays)
 *      and poll until confirmed. On success, stamp the cache and
 *      return `deployed`.
 *
 * Idempotent — safe to call before every transfer that needs the
 * wallet to be deployed. The cache check is constant-time after the
 * first deploy.
 */

import { prisma } from '@sendero/database';

export type ScaDeployResult =
  | { status: 'skipped'; reason: 'eoa' }
  | { status: 'already-deployed' }
  | { status: 'deployed'; txHash: string };

/** Narrow adapter over the Circle DCW SDK methods this helper uses. */
export interface ScaDeploySdk {
  getWallet: (args: { id: string }) => Promise<{
    data?: {
      wallet?: {
        id: string;
        address: string;
        blockchain: string;
        accountType?: 'EOA' | 'SCA';
      };
    };
  }>;
  listTransactions: (args: { walletIds: string[]; pageSize?: number }) => Promise<{
    data?: {
      transactions?: Array<{
        id: string;
        state: string;
        transactionType: string;
        blockchain?: string;
      }>;
    };
  }>;
  createTransaction: (args: {
    walletId: string;
    destinationAddress: string;
    amounts: string[];
    tokenAddress: string;
    blockchain: string;
    fee: { type: string; config: { feeLevel: string } };
  }) => Promise<{ data?: { id: string } }>;
  getTransaction: (args: { id: string }) => Promise<{
    data?: { transaction?: { state?: string; txHash?: string; errorReason?: string } };
  }>;
}

const POLL_INTERVAL_MS = 2_000;
const POLL_MAX_ATTEMPTS = 60; // 120s total — matches sweep service

/**
 * Make sure a Circle DCW SCA is deployed on-chain so it can sign typed
 * data. Use the cache-first overload (`walletRowId`) when calling on a
 * persisted wallet so subsequent calls skip the Circle round-trip
 * entirely.
 */
export async function ensureScaDeployed(args: {
  sdk: ScaDeploySdk;
  /** Circle wallet ID (Circle's UUID, e.g. 'a1b2…'). */
  circleWalletId: string;
  /** Sendero CircleWallet.id (cuid) for the cache. Optional — caller can
   *  skip caching when working with synthetic / one-shot wallets. */
  walletRowId?: string;
}): Promise<ScaDeployResult> {
  // Step 1: cache-first short-circuit.
  if (args.walletRowId) {
    const row = await prisma.circleWallet.findUnique({
      where: { id: args.walletRowId },
      select: { scaDeployedAt: true },
    });
    if (row?.scaDeployedAt) {
      return { status: 'already-deployed' };
    }
  }

  const walletRes = await args.sdk.getWallet({ id: args.circleWalletId });
  const wallet = walletRes?.data?.wallet;
  if (!wallet) {
    throw new Error(`ensureScaDeployed: wallet ${args.circleWalletId} not found`);
  }

  if (wallet.accountType !== 'SCA') {
    return { status: 'skipped', reason: 'eoa' };
  }

  // Step 3: existing OUTBOUND CONFIRMED/COMPLETE means already deployed.
  const txList = await args.sdk.listTransactions({
    walletIds: [args.circleWalletId],
    pageSize: 30,
  });
  const txs = txList?.data?.transactions ?? [];
  const alreadyDeployed = txs.some(
    t => t.transactionType === 'OUTBOUND' && (t.state === 'CONFIRMED' || t.state === 'COMPLETE')
  );
  if (alreadyDeployed) {
    if (args.walletRowId) {
      await prisma.circleWallet.update({
        where: { id: args.walletRowId },
        data: { scaDeployedAt: new Date() },
      });
    }
    return { status: 'already-deployed' };
  }

  // Step 4: deploy via self-send 0 native. Circle Gas Station pays.
  // tokenAddress empty string = native (gas) token, not an ERC-20.
  const deploy = await args.sdk.createTransaction({
    walletId: args.circleWalletId,
    destinationAddress: wallet.address,
    amounts: ['0'],
    tokenAddress: '',
    blockchain: wallet.blockchain,
    fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
  });

  const challengeId = deploy?.data?.id;
  if (!challengeId) {
    throw new Error(
      `ensureScaDeployed: createTransaction returned no id (${JSON.stringify(deploy)})`
    );
  }

  const txHash = await pollTransactionComplete(args.sdk, challengeId);

  if (args.walletRowId) {
    await prisma.circleWallet.update({
      where: { id: args.walletRowId },
      data: { scaDeployedAt: new Date() },
    });
  }

  return { status: 'deployed', txHash };
}

async function pollTransactionComplete(sdk: ScaDeploySdk, challengeId: string): Promise<string> {
  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    const res = await sdk.getTransaction({ id: challengeId });
    const tx = res?.data?.transaction;
    const state = tx?.state;
    if (state === 'CONFIRMED' || state === 'COMPLETE' || state === 'COMPLETED') {
      if (!tx?.txHash) {
        throw new Error(`SCA deploy tx ${challengeId} ${state} but no txHash`);
      }
      return tx.txHash;
    }
    if (state === 'FAILED' || state === 'DENIED') {
      throw new Error(
        `SCA deploy tx ${challengeId} ${state}: ${tx?.errorReason ?? 'unknown'}`
      );
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }

  // Timeout rescue — requery once before declaring failure.
  const final = await sdk.getTransaction({ id: challengeId });
  const tx = final?.data?.transaction;
  if (
    (tx?.state === 'CONFIRMED' || tx?.state === 'COMPLETE' || tx?.state === 'COMPLETED') &&
    tx.txHash
  ) {
    return tx.txHash;
  }
  throw new Error(
    `SCA deploy tx ${challengeId} timed out after ${(POLL_MAX_ATTEMPTS * POLL_INTERVAL_MS) / 1000}s`
  );
}
