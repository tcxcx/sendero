'use server';

/**
 * Phase 7.5.x.yy — install the multi-owner weighted multisig
 * configuration on a deployed Arc MSCA.
 *
 * Sequence:
 *   intent  → 7.5.x   (counterfactual address derived)
 *   pending → 7.5.x.y (MSCA deployed via bundler + Gas Station)
 *   live    → 7.5.x.yy (THIS phase — multi-owner config installed)
 *
 * The MSCA was deployed in 7.5.x.y with the Sendero platform EOA as
 * the sole owner (weight=1, threshold=1). This phase calls
 * `updateMultisigWeights` on the WeightedWebauthnMultisigPlugin to:
 *   1. ADD each form-configured member as an owner (weight=1).
 *   2. Set threshold = treasury.threshold (the form value).
 *
 * The platform EOA stays as a weight=1 owner so Sendero retains an
 * emergency recovery signer; its presence doesn't compromise the
 * multisig because the threshold is enforced. If a deployment needs
 * the platform EOA fully removed, that's a follow-up call (set its
 * weight to 0 in the same `updateMultisigWeights` invocation).
 *
 * Idempotency: writes a `multisigInstallTxRef` + `multisigInstalledAt`
 * on success. Re-running on an installed row returns immediately.
 */

import { createPublicClient, encodeFunctionData, http, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arcTestnet } from 'viem/chains';
import { createBundlerClient } from 'viem/account-abstraction';
import { toCircleSmartAccount, toModularTransport } from '@circle-fin/modular-wallets-core';

import { prisma } from '@sendero/database';

import { requirePlatformRole } from '@/lib/access';
import { createArcUserOperationFeesEstimator } from '@/lib/treasury/arc-userop-fees';
import { ensureCircleServerRuntime } from '@/lib/treasury/circle-server-runtime';

export interface InstallArcMultisigInput {
  treasuryId: string;
}

export type InstallArcMultisigResult =
  | {
      ok: true;
      treasuryId: string;
      userOpHash: Hex;
      addedOwners: Address[];
      threshold: number;
      alreadyInstalled: boolean;
    }
  | { ok: false; error: string };

const DEFAULT_CIRCLE_CLIENT_URL = 'https://modular-sdk.circle.com/v1/rpc/w3s/buidl';

// Same ABI shape as `@sendero/multisig`'s userop-builder. Inlined
// here so the admin app doesn't depend on the desk-v1 helper for
// a single function. If/when the helper grows multi-signer support,
// switch to the package export.
const UPDATE_MULTISIG_WEIGHTS_ABI = [
  {
    inputs: [
      { name: 'ownersToUpdate', type: 'address[]' },
      { name: 'newWeightsToUpdate', type: 'uint256[]' },
      {
        name: 'publicKeyOwnersToUpdate',
        type: 'tuple[]',
        components: [
          { name: 'x', type: 'uint256' },
          { name: 'y', type: 'uint256' },
        ],
      },
      { name: 'pubicKeyNewWeightsToUpdate', type: 'uint256[]' },
      { name: 'newThresholdWeight', type: 'uint256' },
    ],
    name: 'updateMultisigWeights',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

export async function installArcMultisig(
  input: InstallArcMultisigInput
): Promise<InstallArcMultisigResult> {
  const guard = await requirePlatformRole(['superadmin']);
  if (!guard.ok) {
    return { ok: false, error: 'Not authorized — superadmin only.' };
  }

  const treasury = await prisma.superOrgTreasury.findUnique({
    where: { id: input.treasuryId },
  });
  if (!treasury) return { ok: false, error: `Treasury ${input.treasuryId} not found.` };
  if (treasury.chain !== 'arc') return { ok: false, error: 'Treasury is not on Arc.' };
  if (treasury.status !== 'live') {
    return {
      ok: false,
      error: `Treasury status must be 'live' (currently '${treasury.status}'). Run 7.5.x.y deploy first.`,
    };
  }
  if (treasury.multisigInstalledAt) {
    return {
      ok: true,
      treasuryId: treasury.id,
      userOpHash: (treasury.multisigInstallTxRef ?? '0x') as Hex,
      addedOwners: Array.isArray(treasury.members) ? (treasury.members as Address[]) : [],
      threshold: treasury.threshold,
      alreadyInstalled: true,
    };
  }

  const members = Array.isArray(treasury.members)
    ? (treasury.members as string[]).map(m => m.toLowerCase() as Address)
    : [];
  if (members.length === 0) {
    return { ok: false, error: 'Treasury has no members configured.' };
  }
  if (treasury.threshold < 1 || treasury.threshold > members.length + 1) {
    // +1 because the platform EOA stays as a weight=1 backup owner.
    return {
      ok: false,
      error: `Threshold ${treasury.threshold} is out of range for ${members.length} members + 1 platform owner.`,
    };
  }

  const bootstrapPrivateKey = process.env.SENDERO_ARC_BOOTSTRAP_PRIVATE_KEY as Hex | undefined;
  if (!bootstrapPrivateKey) {
    return {
      ok: false,
      error: 'SENDERO_ARC_BOOTSTRAP_PRIVATE_KEY required to sign the install userOp.',
    };
  }
  const clientKey =
    process.env.NEXT_PUBLIC_CIRCLE_CLIENT_KEY ?? process.env.NEXT_PUBLIC_CIRCLE_MODULAR_CLIENT_KEY;
  if (!clientKey) {
    return { ok: false, error: 'NEXT_PUBLIC_CIRCLE_CLIENT_KEY required.' };
  }
  const clientUrl =
    process.env.NEXT_PUBLIC_CIRCLE_CLIENT_URL ??
    process.env.NEXT_PUBLIC_CIRCLE_MODULAR_CLIENT_URL ??
    DEFAULT_CIRCLE_CLIENT_URL;
  const rpcUrl = process.env.ARC_RPC_URL ?? 'https://rpc.testnet.arc.network';

  const owner = privateKeyToAccount(bootstrapPrivateKey);
  ensureCircleServerRuntime();
  const modular = toModularTransport(`${clientUrl}/arcTestnet`, clientKey);
  const publicClient = createPublicClient({ chain: arcTestnet, transport: http(rpcUrl) });

  const account = await toCircleSmartAccount({
    client: publicClient,
    owner,
    name: `sendero-arc-treasury-${treasury.id}`,
  });
  if (account.address.toLowerCase() !== treasury.multisigAddress.toLowerCase()) {
    return {
      ok: false,
      error: `Address mismatch: SDK derived ${account.address}, row has ${treasury.multisigAddress}.`,
    };
  }

  // Encode updateMultisigWeights:
  //   ownersToUpdate          = members
  //   newWeightsToUpdate      = [1, 1, ..., 1]
  //   publicKeyOwnersToUpdate = []   (no WebAuthn owners in this flow)
  //   pubicKeyNewWeightsToUpdate = []
  //   newThresholdWeight      = treasury.threshold
  //
  // The platform EOA's weight is preserved (it was set during deploy);
  // updateMultisigWeights only changes the addresses listed in the
  // arguments + the threshold.
  const weights = members.map(() => 1n);
  const installCallData = encodeFunctionData({
    abi: UPDATE_MULTISIG_WEIGHTS_ABI,
    functionName: 'updateMultisigWeights',
    args: [members, weights, [], [], BigInt(treasury.threshold)],
  });

  const bundlerClient = createBundlerClient({
    chain: arcTestnet,
    transport: modular,
    paymaster: true,
    userOperation: {
      estimateFeesPerGas: createArcUserOperationFeesEstimator(publicClient),
    },
  });

  let userOpHash: Hex;
  try {
    userOpHash = await bundlerClient.sendUserOperation({
      account,
      calls: [{ to: account.address, value: 0n, data: installCallData }],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Bundler sendUserOperation failed: ${message}` };
  }

  try {
    await bundlerClient.waitForUserOperationReceipt({
      hash: userOpHash,
      timeout: 60_000,
    });
  } catch (err) {
    await prisma.superOrgTreasury.update({
      where: { id: treasury.id },
      data: { multisigInstallTxRef: userOpHash },
    });
    return {
      ok: false,
      error: `Submitted (${userOpHash}) but receipt poll timed out: ${err instanceof Error ? err.message : String(err)}. Re-run to reconcile.`,
    };
  }

  await prisma.superOrgTreasury.update({
    where: { id: treasury.id },
    data: {
      multisigInstallTxRef: userOpHash,
      multisigInstalledAt: new Date(),
    },
  });

  return {
    ok: true,
    treasuryId: treasury.id,
    userOpHash,
    addedOwners: members,
    threshold: treasury.threshold,
    alreadyInstalled: false,
  };
}
