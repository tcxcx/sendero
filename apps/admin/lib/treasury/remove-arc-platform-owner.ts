'use server';

/**
 * Phase 7.5.x.yy.y — remove the Sendero platform EOA from a tenant's
 * Arc MSCA owners list, transferring full self-custody.
 *
 * Lifecycle context:
 *   7.5.x.yy installed N members at threshold T while leaving the
 *   platform EOA as a weight=1 recovery signer. That backup is
 *   useful for tenant safety BUT it means Sendero technically holds
 *   a key that can co-sign. This action zeros out the platform's
 *   weight via updateMultisigWeights, putting the multisig in pure
 *   self-custody.
 *
 * Threshold check: with the platform EOA removed, the remaining
 * owners must still satisfy threshold. The install in 7.5.x.yy
 * added all form members at weight=1 — so as long as
 * `members.length >= threshold`, the multisig stays operational.
 * If the user originally configured threshold = members.length + 1
 * (counting the platform EOA), this action would deadlock the
 * multisig. The threshold guard below catches that.
 *
 * Once removed, this is irreversible from this surface — the
 * platform EOA can be re-added only via a future
 * updateMultisigWeights signed by current owners (i.e. through
 * the proposal-execution flow in Phase 7.6).
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

// Inlined: matches packages/multisig/src/constants.ts::WEIGHTED_WEBAUTHN_MULTISIG_PLUGIN_ADDRESS.
const WEIGHTED_WEBAUTHN_MULTISIG_PLUGIN_ADDRESS: Address =
  '0x0000000C984AFf541D6cE86Bb697e68ec57873C8';

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

export interface RemoveArcPlatformOwnerInput {
  treasuryId: string;
}

export type RemoveArcPlatformOwnerResult =
  | {
      ok: true;
      treasuryId: string;
      userOpHash: Hex;
      platformAddress: Address;
      alreadyRemoved: boolean;
    }
  | { ok: false; error: string };

const DEFAULT_CIRCLE_CLIENT_URL = 'https://modular-sdk.circle.com/v1/rpc/w3s/buidl';

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

export async function removeArcPlatformOwner(
  input: RemoveArcPlatformOwnerInput
): Promise<RemoveArcPlatformOwnerResult> {
  const guard = await requirePlatformRole(['superadmin']);
  if (!guard.ok) {
    return { ok: false, error: 'Not authorized — superadmin only.' };
  }

  const treasury = await prisma.superOrgTreasury.findUnique({
    where: { id: input.treasuryId },
  });
  if (!treasury) return { ok: false, error: `Treasury ${input.treasuryId} not found.` };
  if (treasury.chain !== 'arc') return { ok: false, error: 'Treasury is not on Arc.' };
  if (!treasury.multisigInstalledAt) {
    return {
      ok: false,
      error: 'Multisig not yet installed (run Phase 7.5.x.yy first).',
    };
  }

  const bootstrapPrivateKey = process.env.SENDERO_ARC_BOOTSTRAP_PRIVATE_KEY as Hex | undefined;
  if (!bootstrapPrivateKey) {
    return { ok: false, error: 'SENDERO_ARC_BOOTSTRAP_PRIVATE_KEY required.' };
  }
  const platformAddress = privateKeyToAccount(bootstrapPrivateKey).address;

  if (treasury.platformOwnerRemovedAt) {
    return {
      ok: true,
      treasuryId: treasury.id,
      userOpHash: (treasury.platformOwnerRemovalTxRef ?? '0x') as Hex,
      platformAddress,
      alreadyRemoved: true,
    };
  }

  const members = Array.isArray(treasury.members)
    ? (treasury.members as string[]).map(m => m.toLowerCase() as Address)
    : [];

  // Without the platform EOA the threshold must still be reachable.
  // Reject if the remaining members can't satisfy it — would deadlock
  // the multisig.
  if (members.length < treasury.threshold) {
    return {
      ok: false,
      error: `Cannot remove platform owner: threshold ${treasury.threshold} > ${members.length} remaining members. Multisig would deadlock.`,
    };
  }

  const clientKey =
    process.env.NEXT_PUBLIC_CIRCLE_CLIENT_KEY ?? process.env.NEXT_PUBLIC_CIRCLE_MODULAR_CLIENT_KEY;
  if (!clientKey) return { ok: false, error: 'NEXT_PUBLIC_CIRCLE_CLIENT_KEY required.' };
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

  // Idempotency: read on-chain owners. If bootstrap is already absent or
  // its weight is 0, just stamp the DB and return. Prevents
  // updateMultisigWeights from reverting on already-removed state
  // during a retry after a partial DB write.
  try {
    const info = await publicClient.readContract({
      address: WEIGHTED_WEBAUTHN_MULTISIG_PLUGIN_ADDRESS,
      abi: OWNERSHIP_INFO_ABI,
      functionName: 'ownershipInfoOf',
      args: [account.address],
    });
    const ownersData = info[1];
    const platformLower = platformAddress.toLowerCase();
    const platformOwner = ownersData.find(o => o.addr.toLowerCase() === platformLower);
    const platformAlreadyRemoved = !platformOwner || platformOwner.weight === 0n;
    if (platformAlreadyRemoved) {
      await prisma.superOrgTreasury.update({
        where: { id: treasury.id },
        data: { platformOwnerRemovedAt: new Date() },
      });
      return {
        ok: true,
        treasuryId: treasury.id,
        userOpHash: (treasury.platformOwnerRemovalTxRef ?? '0x') as Hex,
        platformAddress,
        alreadyRemoved: true,
      };
    }
  } catch {
    // Read failure — fall through to the userOp.
  }

  // Encode updateMultisigWeights with platformAddress at weight=0.
  // Threshold stays the same (already validated reachable above).
  const removalCallData = encodeFunctionData({
    abi: UPDATE_MULTISIG_WEIGHTS_ABI,
    functionName: 'updateMultisigWeights',
    args: [[platformAddress], [0n], [], [], BigInt(treasury.threshold)],
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
    // Pass `callData` directly (raw plugin call), NOT `calls`. Same
    // reason as install-arc-multisig.ts: Circle's WeightedWebauthnMultisig
    // plugin only implements `userOpValidationFunction`. Wrapping in
    // viem's `calls` produces an `execute()` outer call that hits
    // `runtimeValidationFunction` → NotImplemented → revert.
    userOpHash = await bundlerClient.sendUserOperation({
      account,
      callData: removalCallData,
    });
  } catch (err) {
    return {
      ok: false,
      error: `Bundler sendUserOperation failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  try {
    await bundlerClient.waitForUserOperationReceipt({ hash: userOpHash, timeout: 60_000 });
  } catch (err) {
    await prisma.superOrgTreasury.update({
      where: { id: treasury.id },
      data: { platformOwnerRemovalTxRef: userOpHash },
    });
    return {
      ok: false,
      error: `Submitted (${userOpHash}) but receipt poll timed out: ${err instanceof Error ? err.message : String(err)}. Re-run to reconcile.`,
    };
  }

  await prisma.superOrgTreasury.update({
    where: { id: treasury.id },
    data: {
      platformOwnerRemovalTxRef: userOpHash,
      platformOwnerRemovedAt: new Date(),
    },
  });

  return {
    ok: true,
    treasuryId: treasury.id,
    userOpHash,
    platformAddress,
    alreadyRemoved: false,
  };
}
