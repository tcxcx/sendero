'use server';

/**
 * Phase 7.6.x — reconcile a TreasuryProposal row's `status` against
 * the on-chain proposal PDA.
 *
 * Squads V4 proposals carry a status enum (`__kind`):
 *   Draft / Active / Approved / Rejected / Cancelled / Executed.
 *
 * Our row's status is the off-chain mirror. Called after every
 * approve/reject/execute submitted from the wallet adapter, so the
 * UI reflects on-chain state without a dedicated cron.
 */

import * as multisig from '@sqds/multisig';
import { Connection, PublicKey } from '@solana/web3.js';

import { prisma } from '@sendero/database';

import { requirePlatformRole } from '@/lib/access';

const SOL_DEVNET_RPC = 'https://api.devnet.solana.com';

export type RefreshProposalStatusResult =
  | { ok: true; status: string; approvedCount: number; threshold: number }
  | { ok: false; error: string };

const STATUS_FROM_KIND: Record<string, string> = {
  Draft: 'pending',
  Active: 'pending',
  Approved: 'approved',
  Rejected: 'rejected',
  Cancelled: 'cancelled',
  Executed: 'executed',
};

export async function refreshProposalStatus(
  proposalId: string,
  /** Optional: if the caller just executed, pass the tx sig so we can
   *  stamp `executedTxRef` atomically with the status flip. */
  executedTxRef?: string
): Promise<RefreshProposalStatusResult> {
  const guard = await requirePlatformRole(['superadmin']);
  if (!guard.ok) return { ok: false, error: 'Not authorized.' };

  const row = await prisma.treasuryProposal.findUnique({
    where: { id: proposalId },
    include: { treasury: true },
  });
  if (!row) return { ok: false, error: 'Proposal not found.' };
  if (row.treasury.chain !== 'sol') {
    return { ok: false, error: 'Only Solana proposals supported here.' };
  }

  const connection = new Connection(SOL_DEVNET_RPC, 'confirmed');
  const proposalPda = new PublicKey(row.proposalPda);

  let proposal;
  try {
    proposal = await multisig.accounts.Proposal.fromAccountAddress(connection, proposalPda);
  } catch (err) {
    return {
      ok: false,
      error: `Failed to read proposal PDA: ${(err as Error).message}`,
    };
  }
  // Re-read the multisig to get the current threshold.
  const multisigPda = new PublicKey(row.treasury.multisigAddress);
  const multisigAccount = await multisig.accounts.Multisig.fromAccountAddress(
    connection,
    multisigPda
  );

  const onchainKind = proposal.status.__kind as string;
  const newStatus = STATUS_FROM_KIND[onchainKind] ?? 'pending';
  const approvedCount = proposal.approved.length;
  const threshold = multisigAccount.threshold;

  await prisma.treasuryProposal.update({
    where: { id: proposalId },
    data: {
      status: newStatus,
      approvedCount,
      ...(executedTxRef && newStatus === 'executed' ? { executedTxRef } : {}),
    },
  });

  return { ok: true, status: newStatus, approvedCount, threshold };
}
