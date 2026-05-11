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

// Inlined to avoid adding @sendero/multisig as an admin dep — same
// constant as packages/multisig/src/constants.ts::WEIGHTED_WEBAUTHN_MULTISIG_PLUGIN_ADDRESS.
// Already inlined elsewhere in apps/admin/lib/treasury/compute-arc-msca-address.ts.
const WEIGHTED_WEBAUTHN_MULTISIG_PLUGIN_ADDRESS: Address =
  '0x0000000C984AFf541D6cE86Bb697e68ec57873C8';

// Canonical ABI from desk-v1 (smart-wallet.controller.ts). The Circle
// WeightedWebauthnMultisigPlugin returns (ownerAddresses bytes30[],
// ownersData OwnerData[], thresholdWeight uint256). We only need
// ownersData[].addr to detect already-installed EOA owners.
const OWNERSHIP_INFO_ABI = [
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'ownershipInfoOf',
    outputs: [
      { name: 'ownerAddresses', type: 'bytes30[]' },
      {
        name: 'ownersData',
        type: 'tuple[]',
        components: [
          { name: 'weight', type: 'uint256' },
          { name: 'credType', type: 'uint8' },
          { name: 'addr', type: 'address' },
          { name: 'publicKeyX', type: 'uint256' },
          { name: 'publicKeyY', type: 'uint256' },
        ],
      },
      { name: 'thresholdWeight', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

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

// Circle WeightedWebauthnMultisigPlugin — `addOwners` registers NEW
// owners and atomically updates the threshold. We use this on the
// freshly-deployed MSCA (which has only the platform-EOA bootstrap
// owner) to add the form-configured members. Calling
// `updateMultisigWeights` instead (the earlier code path) reverts
// because that function can only update EXISTING owners; supplying a
// new address there fails the "owner-must-exist" guard with no reason
// string, surfacing as the opaque "execution reverted" we saw.
const ADD_OWNERS_ABI = [
  {
    inputs: [
      { name: 'ownersToAdd', type: 'address[]' },
      { name: 'weightsToAdd', type: 'uint256[]' },
      {
        name: 'publicKeyOwnersToAdd',
        type: 'tuple[]',
        components: [
          { name: 'x', type: 'uint256' },
          { name: 'y', type: 'uint256' },
        ],
      },
      { name: 'publicKeyWeightsToAdd', type: 'uint256[]' },
      { name: 'newThresholdWeight', type: 'uint256' },
    ],
    name: 'addOwners',
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

  // Idempotency: read on-chain owners first. If every form-member is
  // already an owner, treat as installed and short-circuit. addOwners
  // reverts with an opaque "execution reverted" when an owner already
  // exists, so without this guard any retry after a partial DB-state
  // failure deadlocks the lifecycle.
  try {
    const info = await publicClient.readContract({
      address: WEIGHTED_WEBAUTHN_MULTISIG_PLUGIN_ADDRESS,
      abi: OWNERSHIP_INFO_ABI,
      functionName: 'ownershipInfoOf',
      args: [account.address],
    });
    const ownersData = info[1];
    const existingAddrs = new Set(ownersData.map(o => o.addr.toLowerCase()));
    const allMembersAlreadyOwners = members.every(m => existingAddrs.has(m.toLowerCase()));
    if (allMembersAlreadyOwners) {
      await prisma.superOrgTreasury.update({
        where: { id: treasury.id },
        data: { multisigInstalledAt: new Date() },
      });
      return {
        ok: true,
        treasuryId: treasury.id,
        userOpHash: (treasury.multisigInstallTxRef ?? '0x') as Hex,
        addedOwners: members,
        threshold: Number(info[2]),
        alreadyInstalled: true,
      };
    }
  } catch {
    // Read failure (RPC blip / plugin not deployed yet) — fall through
    // to addOwners and let it surface the real revert reason.
  }

  // Encode addOwners:
  //   ownersToAdd            = members (NEW addresses to register)
  //   weightsToAdd           = [1, 1, ..., 1]
  //   publicKeyOwnersToAdd   = [] (no WebAuthn owners in this flow)
  //   publicKeyWeightsToAdd  = []
  //   newThresholdWeight     = treasury.threshold
  //
  // The platform EOA's weight (set during deploy) is preserved — addOwners
  // only adds; existing owners aren't touched. The new threshold applies
  // atomically once the new owners are registered.
  const weights = members.map(() => 1n);
  const installCallData = encodeFunctionData({
    abi: ADD_OWNERS_ABI,
    functionName: 'addOwners',
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
    // CRITICAL: pass `callData` directly (raw plugin call), NOT `calls`.
    //
    // Circle's WeightedWebauthnMultisigPlugin implements ONLY
    // `userOpValidationFunction`, not `runtimeValidationFunction`. Wrapping
    // the plugin call in viem's `calls: [{to, data}]` makes the SDK produce
    // a userOp with `callData = execute(self, 0, pluginData)` — the MSCA
    // sees the OUTER selector as `execute()` and routes through the
    // runtime-validation path → plugin reverts with
    // `RuntimeValidationFailed → NotImplemented`. Confirmed via direct
    // simulation (raw revert = 0x6d4fdb09 wrapping 0x84b9b379 = NotImplemented).
    //
    // Passing `callData` directly lets the MSCA's fallback dispatch the
    // plugin function via the userOp-validation path (which IS implemented).
    // Pattern lifted from desk-v1's submitSmartAccountCallData (which
    // ships in production for the same Circle plugin).
    userOpHash = await bundlerClient.sendUserOperation({
      account,
      callData: installCallData,
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
