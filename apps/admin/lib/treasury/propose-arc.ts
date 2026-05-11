'use server';

/**
 * Arc treasury proposal flow (USDC transfer).
 *
 * Solana parity surface — see propose-solana.ts. Difference:
 * Circle WeightedWebauthnMultisig plugin does NOT keep an on-chain
 * proposal accumulator. Approval is collected off-chain via signed
 * userOps and verified at userOp validation time. So Arc "propose"
 * is purely a DB persist of the encoded ERC-20 transfer call. The
 * sign + execute step ships in Phase 7.6.x alongside the operator's
 * MetaMask signing UI.
 *
 * `TreasuryProposal.transactionPda` / `proposalPda` are Solana-only
 * fields; for Arc rows they're stamped with empty strings (the
 * schema allows it and the UI branches on `kind` / chain). The
 * encoded callData is stashed in `payload` so the signing UI can
 * pick it up without re-encoding (input-handling parity with
 * Solana's `vaultTransactionCreate` capturing the full instruction
 * shape).
 */

import { encodeFunctionData, getAddress, isAddress, type Address } from 'viem';

import { prisma } from '@sendero/database';

import { requirePlatformRole } from '@/lib/access';

const ARC_USDC_ADDRESS: Address = '0x3600000000000000000000000000000000000000';
const USDC_DECIMALS = 6;

const ERC20_TRANSFER_ABI = [
  {
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'transfer',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

export interface ProposeArcUsdcTransferInput {
  treasuryId: string;
  /** EVM `0x…` address. */
  recipient: string;
  /** USDC in human units (e.g. "5.5"). Max 6 decimals. */
  amountUsdc: string;
  /** Optional ≤32-char memo. */
  memo?: string;
}

export type ProposeArcUsdcTransferResult =
  | {
      ok: true;
      proposalId: string;
      txIndex: number;
      callData: `0x${string}`;
    }
  | { ok: false; error: string };

function parseUsdcAmount(input: string): bigint | null {
  const trimmed = input.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) return null;
  const [whole, frac = ''] = trimmed.split('.');
  const padded = (frac + '0'.repeat(USDC_DECIMALS)).slice(0, USDC_DECIMALS);
  return BigInt(whole) * BigInt(10 ** USDC_DECIMALS) + BigInt(padded);
}

export async function proposeArcUsdcTransfer(
  input: ProposeArcUsdcTransferInput
): Promise<ProposeArcUsdcTransferResult> {
  const guard = await requirePlatformRole(['superadmin']);
  if (!guard.ok) {
    return { ok: false, error: 'Not authorized — superadmin only.' };
  }

  const amountMicro = parseUsdcAmount(input.amountUsdc);
  if (amountMicro === null || amountMicro <= 0n) {
    return {
      ok: false,
      error: `Invalid USDC amount: "${input.amountUsdc}" (max 6 decimals).`,
    };
  }
  if (!isAddress(input.recipient.trim())) {
    return { ok: false, error: `Invalid recipient address: "${input.recipient}".` };
  }
  const recipient = getAddress(input.recipient.trim());

  const treasury = await prisma.superOrgTreasury.findUnique({
    where: { id: input.treasuryId },
  });
  if (!treasury) return { ok: false, error: 'Treasury not found.' };
  if (treasury.chain !== 'arc') return { ok: false, error: 'Treasury is not on Arc.' };
  if (treasury.status !== 'live' || !treasury.multisigInstalledAt) {
    return {
      ok: false,
      error: `Treasury is not ready (status="${treasury.status}", installed=${!!treasury.multisigInstalledAt}).`,
    };
  }

  // Encode ERC-20 transfer call (executed against ARC_USDC_ADDRESS by
  // the MSCA at signing time). Stored verbatim in payload so the
  // signing UI can submit it through the bundler without re-encoding.
  const callData = encodeFunctionData({
    abi: ERC20_TRANSFER_ABI,
    functionName: 'transfer',
    args: [recipient, amountMicro],
  });

  // Auto-increment txIndex per treasury. No on-chain counter — DB owns it.
  const lastProposal = await prisma.treasuryProposal.findFirst({
    where: { treasuryId: treasury.id },
    orderBy: { txIndex: 'desc' },
    select: { txIndex: true },
  });
  const txIndex = (lastProposal?.txIndex ?? 0) + 1;

  const row = await prisma.treasuryProposal.create({
    data: {
      treasuryId: treasury.id,
      txIndex,
      transactionPda: '',
      proposalPda: '',
      kind: 'usdc-transfer',
      payload: {
        chain: 'arc',
        recipient,
        amountMicro: amountMicro.toString(),
        memo: input.memo ?? null,
        target: ARC_USDC_ADDRESS,
        callData,
      },
      status: 'pending',
      proposedByUserId: 'superadmin',
    },
  });

  return {
    ok: true,
    proposalId: row.id,
    txIndex,
    callData,
  };
}
