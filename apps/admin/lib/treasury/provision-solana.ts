'use server';

/**
 * Phase 7.4 — Solana multisig provisioning via Squads V4.
 *
 * Server-only. Reads SENDERO_SOLANA_PLATFORM_PRIVATE_KEY from env to
 * sign the `multisigCreateV2` instruction (the platform hot wallet
 * pays for rent + tx fees on devnet). Members + threshold come from
 * the form on /dashboard/treasury.
 *
 * Persists a `SuperOrgTreasury` row capturing the provisioning state
 * so the UI can read state back without re-querying the chain.
 *
 * After provisioning, the multisig vault PDA at index 0 is the
 * recipient for any USDC / SOL the treasury should hold. Phase 7.6
 * transfers Anchor program upgrade authority to the vault PDA via
 * `solana program set-upgrade-authority`.
 */

import * as multisig from '@sqds/multisig';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';

import { prisma } from '@sendero/database';

import { requirePlatformRole } from '@/lib/access';

const SOL_DEVNET_RPC = 'https://api.devnet.solana.com';

export interface ProvisionSolanaInput {
  /** Each entry is a Solana base58 pubkey. The platform hot wallet is
   *  ALWAYS appended as a member so it can pay for follow-up
   *  transactions on the Squads vault even when the human signers are
   *  offline. Threshold is calibrated against (members.length + 1). */
  memberPubkeys: string[];
  /** Required signatures to execute a vault transaction. */
  threshold: number;
  /** Optional descriptor surfaced in the UI. */
  label?: string;
}

export type ProvisionSolanaResult =
  | {
      ok: true;
      treasuryId: string;
      multisigAddress: string;
      vaultAddress: string;
      txSignature: string;
      members: string[];
      threshold: number;
    }
  | { ok: false; error: string };

export async function provisionSolanaMultisig(
  input: ProvisionSolanaInput
): Promise<ProvisionSolanaResult> {
  const guard = await requirePlatformRole(['superadmin']);
  if (!guard.ok) {
    return { ok: false, error: 'Not authorized — superadmin only.' };
  }

  // Validate inputs
  let parsedMembers: PublicKey[];
  try {
    parsedMembers = input.memberPubkeys.map(p => new PublicKey(p.trim()));
  } catch (err) {
    return {
      ok: false,
      error: `Invalid Solana pubkey: ${(err as Error).message}`,
    };
  }
  if (parsedMembers.length === 0) {
    return { ok: false, error: 'At least one member pubkey required.' };
  }
  if (input.threshold < 1 || input.threshold > parsedMembers.length) {
    return {
      ok: false,
      error: `Threshold must be between 1 and ${parsedMembers.length}.`,
    };
  }

  // Load founder keypair from env. Per CLAUDE.md, the platform hot
  // wallet is the canonical Solana signer for Sendero-internal ops.
  const platformKeyB58 = process.env.SENDERO_SOLANA_PLATFORM_PRIVATE_KEY;
  if (!platformKeyB58) {
    return {
      ok: false,
      error:
        'SENDERO_SOLANA_PLATFORM_PRIVATE_KEY not configured. See CLAUDE.md › Solana gas abstraction.',
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

  // Sanity check: the founder needs lamports to pay rent + tx fees.
  // Squads multisig creation costs ~0.005 SOL; platform wallet runbook
  // says ≥1 SOL on devnet. Hard-fail here with a clear message instead
  // of letting the SDK throw a confusing "insufficient funds" error.
  const founderBalance = await connection.getBalance(creator.publicKey);
  if (founderBalance < 0.01 * LAMPORTS_PER_SOL) {
    return {
      ok: false,
      error: `Founder keypair has ${(founderBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL — needs ≥0.01 to provision a multisig. Top up at https://faucet.solana.com (address: ${creator.publicKey.toBase58()}).`,
    };
  }

  // Squads V4 createV2: the createKey is a one-time-use keypair that
  // seeds the multisig PDA. Save its pubkey for audit trail.
  const createKey = Keypair.generate();
  const [multisigPda] = multisig.getMultisigPda({
    createKey: createKey.publicKey,
  });
  const [vaultPda] = multisig.getVaultPda({ multisigPda, index: 0 });

  // Append the founder keypair as a member so Sendero ops can keep
  // moving even when human signers are offline (paired with a
  // threshold ≤ humanCount so founder alone can't unilaterally execute).
  const memberConfigs = [
    ...parsedMembers.map(key => ({
      key,
      permissions: multisig.types.Permissions.all(),
    })),
    {
      key: creator.publicKey,
      permissions: multisig.types.Permissions.fromPermissions([
        multisig.types.Permission.Vote,
      ]),
    },
  ];

  let txSignature: string;
  try {
    txSignature = await multisig.rpc.multisigCreateV2({
      connection,
      createKey,
      creator,
      multisigPda,
      configAuthority: null, // immutable config — members can only change via proposal
      threshold: input.threshold,
      members: memberConfigs,
      timeLock: 0,
      rentCollector: null,
      treasury: creator.publicKey, // refunds rent on close (Squads convention)
    });
  } catch (err) {
    return {
      ok: false,
      error: `Squads V4 createV2 failed: ${(err as Error).message}`,
    };
  }

  // Persist the live row.
  const row = await prisma.superOrgTreasury.create({
    data: {
      chain: 'sol',
      network: 'sol-devnet',
      multisigAddress: multisigPda.toBase58(),
      vaultAddress: vaultPda.toBase58(),
      threshold: input.threshold,
      members: input.memberPubkeys,
      createKey: createKey.publicKey.toBase58(),
      provisioningTxRef: txSignature,
      status: 'live',
      provisionedByUserId: guard.roles.length > 0 ? 'superadmin' : 'unknown',
    },
  });

  return {
    ok: true,
    treasuryId: row.id,
    multisigAddress: row.multisigAddress,
    vaultAddress: row.vaultAddress,
    txSignature,
    members: input.memberPubkeys,
    threshold: input.threshold,
  };
}

/** Read the live Solana treasury for the dashboard. Returns null when
 *  no row exists yet (treasury card renders the provisioning form). */
export async function getSolanaTreasury() {
  const row = await prisma.superOrgTreasury.findFirst({
    where: { chain: 'sol', status: { not: 'failed' } },
    orderBy: { createdAt: 'desc' },
  });
  return row;
}
