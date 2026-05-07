'use server';

/**
 * Phase 7.6 — Solana treasury proposal flow.
 *
 * Builds a Squads V4 `vaultTransactionCreate` + `proposalCreate` pair
 * for a USDC transfer from the treasury vault. The platform keypair
 * (added as a Vote-only signer in Phase 7.4) pays for tx fees + acts
 * as the `creator` for both calls.
 *
 * Approve + execute UI ships in Phase 7.6.x — that's where the human
 * signers connect a Solana wallet adapter and call
 * `proposalApprove` / `vaultTransactionExecute` from the browser.
 */

import * as multisig from '@sqds/multisig';
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import bs58 from 'bs58';

import { prisma } from '@sendero/database';

import { requirePlatformRole } from '@/lib/access';

const SOL_DEVNET_RPC = 'https://api.devnet.solana.com';
/** USDC devnet mint — the same one cloned into the local validator
 *  by Anchor.toml in `contracts/programs-solana/`. */
const USDC_DEVNET_MINT = new PublicKey(
  '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
);
const USDC_DECIMALS = 6;

export interface ProposeUsdcTransferInput {
  treasuryId: string;
  /** Solana base58 pubkey. Recipient ATA is derived (allowOwnerOffCurve=false). */
  recipient: string;
  /** USDC amount in human units (e.g. "5.5"). Converted to micro internally. */
  amountUsdc: string;
  /** Optional 32-char memo for the proposal description. */
  memo?: string;
}

export type ProposeUsdcTransferResult =
  | {
      ok: true;
      proposalId: string;
      txIndex: number;
      transactionPda: string;
      proposalPda: string;
      proposalTxRef: string;
    }
  | { ok: false; error: string };

function parseUsdcAmount(input: string): bigint | null {
  const trimmed = input.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) return null;
  const [whole, frac = ''] = trimmed.split('.');
  const padded = (frac + '0'.repeat(USDC_DECIMALS)).slice(0, USDC_DECIMALS);
  return BigInt(whole) * BigInt(10 ** USDC_DECIMALS) + BigInt(padded);
}

export async function proposeSolanaUsdcTransfer(
  input: ProposeUsdcTransferInput
): Promise<ProposeUsdcTransferResult> {
  const guard = await requirePlatformRole(['superadmin']);
  if (!guard.ok) {
    return { ok: false, error: 'Not authorized — superadmin only.' };
  }

  // Validate inputs.
  const amountMicro = parseUsdcAmount(input.amountUsdc);
  if (amountMicro === null || amountMicro <= 0n) {
    return {
      ok: false,
      error: `Invalid USDC amount: "${input.amountUsdc}" (max 6 decimals).`,
    };
  }
  let recipientPubkey: PublicKey;
  try {
    recipientPubkey = new PublicKey(input.recipient.trim());
  } catch (err) {
    return {
      ok: false,
      error: `Invalid recipient pubkey: ${(err as Error).message}`,
    };
  }

  // Load treasury row + verify it's a live Solana multisig.
  const treasury = await prisma.superOrgTreasury.findUnique({
    where: { id: input.treasuryId },
  });
  if (!treasury) return { ok: false, error: 'Treasury not found.' };
  if (treasury.chain !== 'sol') {
    return { ok: false, error: 'Treasury is not on Solana.' };
  }
  if (treasury.status !== 'live') {
    return {
      ok: false,
      error: `Treasury status is "${treasury.status}", expected "live".`,
    };
  }

  // Load platform keypair from env.
  const platformKeyB58 = process.env.SENDERO_SOLANA_PLATFORM_PRIVATE_KEY;
  if (!platformKeyB58) {
    return {
      ok: false,
      error: 'SENDERO_SOLANA_PLATFORM_PRIVATE_KEY not configured.',
    };
  }
  let creator: Keypair;
  try {
    creator = Keypair.fromSecretKey(bs58.decode(platformKeyB58));
  } catch (err) {
    return {
      ok: false,
      error: `Failed to decode platform keypair: ${(err as Error).message}`,
    };
  }

  const connection = new Connection(SOL_DEVNET_RPC, 'confirmed');
  const multisigPda = new PublicKey(treasury.multisigAddress);
  const vaultPda = new PublicKey(treasury.vaultAddress);

  // Read multisig account to get current transactionIndex.
  let multisigAccount;
  try {
    multisigAccount = await multisig.accounts.Multisig.fromAccountAddress(
      connection,
      multisigPda
    );
  } catch (err) {
    return {
      ok: false,
      error: `Failed to read multisig account: ${(err as Error).message}`,
    };
  }
  const txIndex = BigInt(Number(multisigAccount.transactionIndex)) + 1n;
  const txIndexNum = Number(txIndex);
  const [transactionPda] = multisig.getTransactionPda({
    multisigPda,
    index: txIndex,
  });
  const [proposalPda] = multisig.getProposalPda({
    multisigPda,
    transactionIndex: txIndex,
  });

  // Build the USDC transfer instruction. Vault PDA is the source ATA
  // owner (allowOwnerOffCurve=true since vault is a PDA).
  const vaultAta = getAssociatedTokenAddressSync(
    USDC_DEVNET_MINT,
    vaultPda,
    /* allowOwnerOffCurve */ true
  );
  const recipientAta = getAssociatedTokenAddressSync(
    USDC_DEVNET_MINT,
    recipientPubkey,
    /* allowOwnerOffCurve */ false
  );
  const transferIx = createTransferCheckedInstruction(
    vaultAta,
    USDC_DEVNET_MINT,
    recipientAta,
    vaultPda,
    amountMicro,
    USDC_DECIMALS,
    /* multiSigners */ [],
    TOKEN_PROGRAM_ID
  );

  const recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  const transactionMessage = new TransactionMessage({
    payerKey: vaultPda,
    recentBlockhash,
    instructions: [transferIx],
  });

  // Squads V4: create the vault transaction.
  let proposalTxRef: string;
  try {
    proposalTxRef = await multisig.rpc.vaultTransactionCreate({
      connection,
      feePayer: creator,
      multisigPda,
      transactionIndex: txIndex,
      creator: creator.publicKey,
      vaultIndex: 0,
      ephemeralSigners: 0,
      transactionMessage,
      memo: input.memo?.slice(0, 32),
    });
  } catch (err) {
    return {
      ok: false,
      error: `vaultTransactionCreate failed: ${(err as Error).message}`,
    };
  }

  // Then create the proposal for it.
  try {
    await multisig.rpc.proposalCreate({
      connection,
      feePayer: creator,
      multisigPda,
      transactionIndex: txIndex,
      creator,
    });
  } catch (err) {
    return {
      ok: false,
      error: `proposalCreate failed: ${(err as Error).message}`,
    };
  }

  // Persist row.
  const row = await prisma.treasuryProposal.create({
    data: {
      treasuryId: treasury.id,
      txIndex: txIndexNum,
      transactionPda: transactionPda.toBase58(),
      proposalPda: proposalPda.toBase58(),
      kind: 'usdc-transfer',
      payload: {
        recipient: recipientPubkey.toBase58(),
        amountMicro: amountMicro.toString(),
        memo: input.memo ?? null,
      },
      proposalTxRef,
      status: 'pending',
      proposedByUserId: 'superadmin',
    },
  });

  return {
    ok: true,
    proposalId: row.id,
    txIndex: txIndexNum,
    transactionPda: row.transactionPda,
    proposalPda: row.proposalPda,
    proposalTxRef,
  };
}

/** Read all proposals for a treasury, newest first. */
export async function listTreasuryProposals(treasuryId: string) {
  return prisma.treasuryProposal.findMany({
    where: { treasuryId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
}
