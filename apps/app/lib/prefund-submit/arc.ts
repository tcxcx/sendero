/**
 * Server-side Arc prefund submission.
 *
 * Pays the trip escrow from the tenant's EVM gateway signer EOA — no
 * buyer passkey involved. Steps:
 *
 *   1. Check the signer EOA's plain Arc USDC balance.
 *   2. If insufficient, materialize the gap from the Gateway pool via
 *      `spendTenantUnifiedUsd` (recipient = signer.address, dest = Arc).
 *   3. Sign + submit `approve(escrow, budget)`.
 *   4. Sign + submit `createTrip(...)` (or whichever calls the tool
 *      returned).
 *
 * Why the gateway signer EOA and not a Circle DCW: we own its private
 * key, so submitting an arbitrary contract call via viem is a one-line
 * walletClient.sendTransaction. Circle DCW contractExecution would
 * also work but adds an SDK round-trip per call. EOA path is faster
 * and reuses the gas the EOA already gets faucet-dripped.
 */

import { spendTenantUnifiedUsd } from '@sendero/circle/unified-balance';
import { getOrCreateGatewaySigner } from '@sendero/circle/gateway-signer';
import { getArcClient } from '@sendero/arc/chain';
import { type Address, type Hex, createWalletClient, http, parseAbi, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const ARC_USDC = '0x3600000000000000000000000000000000000000' as Address;
const ARC_USDC_DECIMALS = 6;

const USDC_ABI = parseAbi(['function balanceOf(address) view returns (uint256)']);

export interface ArcOnchainCall {
  to: string;
  data: string;
  /** Either a 0x-hex string or a decimal string. We coerce to bigint. */
  value?: string;
}

export interface SubmitArcPrefundArgs {
  tenantId: string;
  /** Decimal USDC budget (e.g. "5.00"). Drives the materialize amount. */
  budgetUsdc: string;
  /** Pre-built on-chain calls from `prefundTripTool` (Arc shape). */
  onchainCalls: ArcOnchainCall[];
  /** Optional override for the Arc RPC URL. */
  rpcUrl?: string;
}

export interface SubmitArcPrefundResult {
  /** All confirmed tx hashes in submission order. */
  txHashes: string[];
  /** True when we had to spend from Gateway pool to fund the EOA. */
  materializedFromPool: boolean;
  /** EVM gateway signer address (= msg.sender of every tx). */
  signerAddress: Address;
}

function decimalToMicro(decimal: string): bigint {
  return parseUnits(decimal, ARC_USDC_DECIMALS);
}

function coerceValue(raw: string | undefined): bigint {
  if (!raw) return 0n;
  if (raw.startsWith('0x')) return BigInt(raw);
  return BigInt(raw);
}

/**
 * Materialize USDC from Gateway pool when the signer EOA is short.
 * Recipient is the signer itself — App Kit's spend mints USDC at the
 * recipient address on Arc, which becomes a plain on-chain balance
 * available to subsequent approve/transferFrom calls.
 *
 * No-op when the EOA already has enough USDC (warm path after the
 * first prefund).
 */
async function ensureSignerUsdcOnArc(args: {
  tenantId: string;
  signerAddress: Address;
  amountMicro: bigint;
}): Promise<boolean> {
  const client = getArcClient();
  // viem 2.48 narrows readContract via the EIP-7702 `authorizationList`
  // generic — irrelevant for a view call. Cast at the boundary; the
  // runtime call is identical (mirrors `resend-auth.ts`).
  const readContract = client.readContract as unknown as (
    args: Record<string, unknown>
  ) => Promise<bigint>;
  const balance = await readContract({
    address: ARC_USDC,
    abi: USDC_ABI,
    functionName: 'balanceOf',
    args: [args.signerAddress],
  });
  if (balance >= args.amountMicro) return false;
  const gapMicro = args.amountMicro - balance;
  // Round up to 6-decimal precision (already micro).
  const gapDecimal = (Number(gapMicro) / 1e6).toFixed(6);
  await spendTenantUnifiedUsd({
    tenantId: args.tenantId,
    amount: gapDecimal,
    destinationChain: 'Arc_Testnet',
    recipient: args.signerAddress,
  });
  // Confirm by re-reading balance — guards against silent
  // attestation lag where spend returns success but the destination
  // mint hasn't reflected yet.
  for (let i = 0; i < 8; i++) {
    const after = await readContract({
      address: ARC_USDC,
      abi: USDC_ABI,
      functionName: 'balanceOf',
      args: [args.signerAddress],
    });
    if (after >= args.amountMicro) return true;
    await new Promise(r => setTimeout(r, 1500));
  }
  throw new Error(
    `prefund/arc: materialized $${gapDecimal} from Gateway pool but signer balance still below required amount`
  );
}

export async function submitArcPrefund(
  args: SubmitArcPrefundArgs
): Promise<SubmitArcPrefundResult> {
  const signer = await getOrCreateGatewaySigner(args.tenantId);
  const account = privateKeyToAccount(signer.privateKey);
  const arcClient = getArcClient();
  // viem v2 walletClient — wraps the public client with signing.
  const walletClient = createWalletClient({
    account,
    chain: arcClient.chain,
    transport: http(args.rpcUrl ?? arcClient.transport.url),
  });

  const budgetMicro = decimalToMicro(args.budgetUsdc);
  const materializedFromPool = await ensureSignerUsdcOnArc({
    tenantId: args.tenantId,
    signerAddress: account.address,
    amountMicro: budgetMicro,
  });

  // viem 2.48 narrows sendTransaction via the EIP-4844 `kzg` generic;
  // we never send blobs. Cast at the boundary, runtime call is
  // identical (same pattern as the readContract cast above).
  const sendTransaction = walletClient.sendTransaction as unknown as (
    args: Record<string, unknown>
  ) => Promise<Hex>;
  const txHashes: string[] = [];
  for (const call of args.onchainCalls) {
    const hash: Hex = await sendTransaction({
      to: call.to as Address,
      data: call.data as Hex,
      value: coerceValue(call.value),
    });
    // Block on receipt so a failing approve doesn't silently consume
    // the EOA's gas and leave createTrip hanging on an un-approved
    // allowance.
    const receipt = await arcClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') {
      throw new Error(`prefund/arc: tx ${hash} reverted at call ${call.to}`);
    }
    txHashes.push(hash);
  }

  return {
    txHashes,
    materializedFromPool,
    signerAddress: account.address,
  };
}
