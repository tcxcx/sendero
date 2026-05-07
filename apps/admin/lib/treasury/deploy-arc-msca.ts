'use server';

/**
 * Phase 7.5.x — server-side counterfactual MSCA derivation for Arc.
 *
 * Replaces the keccak256(members+threshold) placeholder address from
 * Phase 7.5's intent mode with the REAL Circle Modular Smart Contract
 * Account address derived via `toCircleSmartAccount` against the
 * Circle factory on Arc.
 *
 * The deploy flow on Arc MSCA is two-staged:
 *   1. **Counterfactual address** — `toCircleSmartAccount({ client, owner })`
 *      reads the factory's `getAddress(salt, owner, ownerFunctionId)`
 *      view function and returns the predicted address. NO on-chain
 *      tx. The MSCA doesn't exist yet — it's just where it WILL exist.
 *   2. **Deploy** — happens lazily on the first userOp. The bundler
 *      receives `factoryData` from `account.getFactoryArgs()` and
 *      bundles the create2 call into the same userOp that does the
 *      first action. Gas Station paymaster sponsors.
 *
 * Phase 7.5.x v1 does step (1) only — derives the real address, flips
 * status from 'intent' to 'pending'. The first deploy userOp lands
 * when an operator submits a real treasury action via the admin app.
 *
 * Multi-owner weighted multisig (the actual `members` + `threshold`
 * input) gets installed via a SECOND userOp that calls the
 * WeightedMultisigPlugin's install method. `buildBatchInstallCalls`
 * from `@sendero/multisig` already builds those calls; wiring them
 * to the bundler is part of the proposal-execution flow (Phase
 * 7.6.x.y when treasury proposals can install plugins on Arc).
 *
 * Why use the Sendero platform EOA as bootstrap owner: same pattern
 * Phase 7.4 used for Solana — the platform key is a Vote-only signer
 * that bootstraps the multisig. Real members + threshold are
 * configured AFTER deploy via the multisig plugin install.
 */

import { createPublicClient, http, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arcTestnet } from 'viem/chains';
import { toCircleSmartAccount } from '@circle-fin/modular-wallets-core';

import { prisma } from '@sendero/database';

import { requirePlatformRole } from '@/lib/access';

export interface DeriveArcMscaInput {
  treasuryId: string;
}

export type DeriveArcMscaResult =
  | {
      ok: true;
      treasuryId: string;
      counterfactualAddress: Address;
      previousAddress: string;
      status: 'pending';
    }
  | { ok: false; error: string };

/**
 * Read the Arc treasury's intent row and replace its placeholder
 * address with the real counterfactual MSCA address.
 *
 * Idempotent — once the row's `multisigAddress` matches the derived
 * value AND status is `'pending'`, calling again is a no-op.
 */
export async function deriveArcMscaCounterfactual(
  input: DeriveArcMscaInput
): Promise<DeriveArcMscaResult> {
  const guard = await requirePlatformRole(['superadmin']);
  if (!guard.ok) {
    return { ok: false, error: 'Not authorized — superadmin only.' };
  }

  const treasury = await prisma.superOrgTreasury.findUnique({
    where: { id: input.treasuryId },
  });
  if (!treasury) {
    return { ok: false, error: `Treasury ${input.treasuryId} not found.` };
  }
  if (treasury.chain !== 'arc') {
    return { ok: false, error: `Treasury ${input.treasuryId} is not on Arc.` };
  }

  const bootstrapPrivateKey = process.env.SENDERO_ARC_BOOTSTRAP_PRIVATE_KEY as Hex | undefined;
  if (!bootstrapPrivateKey) {
    return {
      ok: false,
      error:
        'SENDERO_ARC_BOOTSTRAP_PRIVATE_KEY required. This EOA is the bootstrap owner that deploys the MSCA. Real members install via the WeightedMultisig plugin AFTER deploy.',
    };
  }

  const rpcUrl = process.env.ARC_RPC_URL ?? 'https://rpc.testnet.arc.network';

  const owner = privateKeyToAccount(bootstrapPrivateKey);
  const client = createPublicClient({
    chain: arcTestnet,
    transport: http(rpcUrl, { retryCount: 3, timeout: 15_000 }),
  });

  let account: Awaited<ReturnType<typeof toCircleSmartAccount>>;
  try {
    account = await toCircleSmartAccount({
      client,
      owner,
      // Stable wallet name — derives a deterministic salt so the
      // counterfactual address is reproducible across calls.
      name: `sendero-arc-treasury-${input.treasuryId}`,
    });
  } catch (err) {
    return {
      ok: false,
      error: `toCircleSmartAccount failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const counterfactualAddress = account.address;
  const previousAddress = treasury.multisigAddress;

  // Idempotent: if the row already has the correct address + status,
  // just echo back. Otherwise update both fields atomically.
  if (
    treasury.multisigAddress.toLowerCase() === counterfactualAddress.toLowerCase() &&
    treasury.status === 'pending'
  ) {
    return {
      ok: true,
      treasuryId: treasury.id,
      counterfactualAddress,
      previousAddress,
      status: 'pending',
    };
  }

  await prisma.superOrgTreasury.update({
    where: { id: treasury.id },
    data: {
      multisigAddress: counterfactualAddress,
      // vault address on EVM = MSCA itself (no separate vault PDA);
      // mirror the multisig address for UI consistency with Solana.
      vaultAddress: counterfactualAddress,
      status: 'pending',
    },
  });

  return {
    ok: true,
    treasuryId: treasury.id,
    counterfactualAddress,
    previousAddress,
    status: 'pending',
  };
}
