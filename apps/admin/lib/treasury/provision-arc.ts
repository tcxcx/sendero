'use server';

/**
 * Phase 7.5 (intent mode) — Arc Circle MSCA provisioning.
 *
 * **What this turn ships:** form + server action + persistence with
 * status `'intent'`. The form captures intended members + threshold;
 * the row is persisted with a deterministic placeholder address
 * derived via `keccak256(members + threshold)`. UI reads back the
 * intent state.
 *
 * **What this turn DOES NOT ship:** actual on-chain MSCA deployment.
 * The package `@sendero/multisig` ships pure userOp BUILDERS
 * (`buildTreasurySetupUserOp`) + a `submitUserOp` primitive, but the
 * gap to an end-to-end deploy is substantial:
 *   - counterfactual MSCA address from `MODULAR_WALLET_FACTORY` +
 *     bootstrap-signer pubkey + salt
 *   - bundler client wiring (Circle's `modular-sdk.circle.com`
 *     bundler RPC + Gas Station paymaster setup)
 *   - EOA-vs-passkey bootstrap split (the existing
 *     `packages/circle/src/modular-wallets.ts` is passkey-only,
 *     browser-side; server-side EOA bootstrap requires net-new code)
 *   - sign + submit + confirm round-trip with retries
 *
 * Phase 7.5.x will fold those in. Schema + UI shape are stable —
 * the deploy step replaces the placeholder address + flips status
 * from `intent` to `live`.
 */

import { keccak256, isAddress, toHex } from 'viem';

import { prisma } from '@sendero/database';

import { requirePlatformRole } from '@/lib/access';

export interface ProvisionArcInput {
  /** Each entry is a 0x-prefixed EVM address. v1 stores intended
   *  signers — they get re-weighted onto the MSCA in 7.5.x. */
  memberAddresses: string[];
  /** Required signatures to execute a userOp. */
  threshold: number;
}

export type ProvisionArcResult =
  | {
      ok: true;
      treasuryId: string;
      placeholderAddress: string;
      status: 'intent';
      members: string[];
      threshold: number;
    }
  | { ok: false; error: string };

/**
 * Persist an intent row for an Arc multisig treasury. The actual
 * on-chain MSCA deploy is a follow-up (Phase 7.5.x).
 */
export async function provisionArcMultisigIntent(
  input: ProvisionArcInput
): Promise<ProvisionArcResult> {
  const guard = await requirePlatformRole(['superadmin']);
  if (!guard.ok) {
    return { ok: false, error: 'Not authorized — superadmin only.' };
  }

  // Validate addresses (case-insensitive, EIP-55 not enforced here —
  // we lower-case before hashing for stable intent IDs).
  const members = input.memberAddresses.map(a => a.trim().toLowerCase());
  for (const a of members) {
    if (!isAddress(a)) {
      return { ok: false, error: `Invalid EVM address: ${a}` };
    }
  }
  if (members.length === 0) {
    return { ok: false, error: 'At least one member address required.' };
  }
  if (input.threshold < 1 || input.threshold > members.length) {
    return {
      ok: false,
      error: `Threshold must be between 1 and ${members.length}.`,
    };
  }

  // Deterministic placeholder address. Phase 7.5.x replaces this with
  // the actual counterfactual MSCA address from the Circle factory.
  // Format: `0x` + 40-char hex of keccak256(sortedMembers + threshold).
  // Uniqueness: same inputs → same placeholder, so the form is
  // idempotent (re-submitting same intent returns the same row).
  const sorted = [...members].sort();
  const intentSeed = `intent:arc:${sorted.join(',')}:${input.threshold}`;
  const hash = keccak256(toHex(intentSeed));
  const placeholderAddress = `0x${hash.slice(2, 42)}`;

  // Idempotent upsert keyed on placeholderAddress (which is unique by
  // construction for a given (members, threshold) tuple).
  const existing = await prisma.superOrgTreasury.findUnique({
    where: { multisigAddress: placeholderAddress },
  });

  const row = existing
    ? existing
    : await prisma.superOrgTreasury.create({
        data: {
          chain: 'arc',
          network: 'arc-testnet',
          multisigAddress: placeholderAddress,
          vaultAddress: placeholderAddress,
          threshold: input.threshold,
          members,
          createKey: null,
          provisioningTxRef: null,
          status: 'intent',
          provisionedByUserId: 'superadmin',
        },
      });

  return {
    ok: true,
    treasuryId: row.id,
    placeholderAddress: row.multisigAddress,
    status: 'intent',
    members: Array.isArray(row.members) ? (row.members as string[]) : members,
    threshold: row.threshold,
  };
}

/**
 * Read the most "advanced" non-failed Arc treasury for the dashboard.
 *
 * Status precedence beats recency: a completed `live` row must win
 * over a stray `intent` row that the form created from a duplicate
 * submit. Without this, a re-fired POST overwrites the visible
 * treasury with a placeholder address and the page renders as
 * Reserved even though a working MSCA already exists.
 *
 * Within the same status, newest wins.
 */
export async function getArcTreasury() {
  const rows = await prisma.superOrgTreasury.findMany({
    where: { chain: 'arc', status: { not: 'failed' } },
    orderBy: { createdAt: 'desc' },
  });
  if (rows.length === 0) return null;
  const rank = (status: string) => (status === 'live' ? 2 : status === 'pending' ? 1 : 0);
  return rows.reduce((best, candidate) =>
    rank(candidate.status) > rank(best.status) ? candidate : best
  );
}
