'use server';

/**
 * Phase 7.5.x.y — actually deploy the Arc MSCA on-chain.
 *
 * Phase 7.5.x derived the counterfactual address (real, predictable,
 * but no contract bytecode at it yet). This action submits the first
 * userOp via Circle's bundler — the bundler picks up `factoryArgs`
 * from `account.getFactoryArgs()` and bundles the create2 deploy
 * into the same userOp that fires the bootstrap action. Gas Station
 * paymaster sponsors the cost transparently via the modular
 * transport's wired-in paymaster RPC.
 *
 * Bootstrap shape: a no-op self-call (transfer 0 to self). The
 * point of this userOp is to TRIGGER the lazy create2 — the call
 * itself is intentionally trivial. Multi-owner weighted multisig
 * install lands in Phase 7.5.x.yy via a SECOND userOp that
 * configures WeightedWebauthnMultisigPlugin from the row's
 * persisted members + threshold (the call shape exists in
 * @sendero/multisig::buildBatchInstallCalls).
 *
 * Status flow:
 *   intent  →  pending  (Phase 7.5.x — counterfactual derived)
 *   pending →  live     (Phase 7.5.x.y — deploy userOp confirmed)
 *
 * Idempotency: the bundler returns the same userOpHash for an
 * already-submitted userOp under the same nonce. After a successful
 * deploy `getCode(address)` returns non-empty bytecode, so re-runs
 * detect this and short-circuit to status='live' without re-sending.
 */

import { createPublicClient, http, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arcTestnet } from 'viem/chains';
import { createBundlerClient } from 'viem/account-abstraction';
import {
  toCircleSmartAccount,
  toModularTransport,
} from '@circle-fin/modular-wallets-core';

import { prisma } from '@sendero/database';

import { requirePlatformRole } from '@/lib/access';

export interface DeployArcMscaInput {
  treasuryId: string;
}

export type DeployArcMscaResult =
  | {
      ok: true;
      treasuryId: string;
      address: Address;
      userOpHash: Hex;
      status: 'live';
      alreadyDeployed: boolean;
    }
  | { ok: false; error: string };

const ARC_MIN_PRIORITY_FEE_PER_GAS = 1_000_000_000n;
const DEFAULT_CIRCLE_CLIENT_URL = 'https://modular-sdk.circle.com/v1/rpc/w3s/buidl';

export async function deployArcMscaUserOp(
  input: DeployArcMscaInput
): Promise<DeployArcMscaResult> {
  const guard = await requirePlatformRole(['superadmin']);
  if (!guard.ok) {
    return { ok: false, error: 'Not authorized — superadmin only.' };
  }

  const treasury = await prisma.superOrgTreasury.findUnique({
    where: { id: input.treasuryId },
  });
  if (!treasury) return { ok: false, error: `Treasury ${input.treasuryId} not found.` };
  if (treasury.chain !== 'arc') return { ok: false, error: 'Treasury is not on Arc.' };
  if (treasury.status === 'intent') {
    return {
      ok: false,
      error: 'Counterfactual address not yet derived. Run Phase 7.5.x derivation first.',
    };
  }
  if (treasury.status === 'live') {
    return {
      ok: true,
      treasuryId: treasury.id,
      address: treasury.multisigAddress as Address,
      userOpHash: (treasury.provisioningTxRef ?? '0x') as Hex,
      status: 'live',
      alreadyDeployed: true,
    };
  }

  const bootstrapPrivateKey = process.env.SENDERO_ARC_BOOTSTRAP_PRIVATE_KEY as Hex | undefined;
  if (!bootstrapPrivateKey) {
    return {
      ok: false,
      error: 'SENDERO_ARC_BOOTSTRAP_PRIVATE_KEY required for the deploy userOp signature.',
    };
  }
  const clientKey =
    process.env.NEXT_PUBLIC_CIRCLE_CLIENT_KEY ??
    process.env.NEXT_PUBLIC_CIRCLE_MODULAR_CLIENT_KEY;
  if (!clientKey) {
    return {
      ok: false,
      error:
        'NEXT_PUBLIC_CIRCLE_CLIENT_KEY required for the modular transport (bundler + paymaster).',
    };
  }
  const clientUrl =
    process.env.NEXT_PUBLIC_CIRCLE_CLIENT_URL ??
    process.env.NEXT_PUBLIC_CIRCLE_MODULAR_CLIENT_URL ??
    DEFAULT_CIRCLE_CLIENT_URL;
  const rpcUrl = process.env.ARC_RPC_URL ?? 'https://rpc.testnet.arc.network';

  const owner = privateKeyToAccount(bootstrapPrivateKey);
  const modular = toModularTransport(`${clientUrl}/arcTestnet`, clientKey);
  const publicClient = createPublicClient({
    chain: arcTestnet,
    transport: modular,
  });

  let account: Awaited<ReturnType<typeof toCircleSmartAccount>>;
  try {
    account = await toCircleSmartAccount({
      client: publicClient,
      owner,
      name: `sendero-arc-treasury-${treasury.id}`,
    });
  } catch (err) {
    return {
      ok: false,
      error: `toCircleSmartAccount failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Sanity: the address from the SDK MUST match the row's address
  // (Phase 7.5.x derived it via the same SDK). If they diverge, the
  // bootstrap key changed or the salt drifted — fail loudly rather
  // than deploy at a wrong address.
  if (account.address.toLowerCase() !== treasury.multisigAddress.toLowerCase()) {
    return {
      ok: false,
      error: `Address mismatch: SDK derived ${account.address} but row has ${treasury.multisigAddress}. Re-run Phase 7.5.x derivation.`,
    };
  }

  // Detect an already-deployed contract — re-running deploy on a
  // live MSCA is a no-op; we just flip status if persistence is
  // out of sync.
  const code = await publicClient.getCode({ address: account.address });
  if (code && code !== '0x') {
    await prisma.superOrgTreasury.update({
      where: { id: treasury.id },
      data: { status: 'live' },
    });
    return {
      ok: true,
      treasuryId: treasury.id,
      address: account.address,
      userOpHash: (treasury.provisioningTxRef ?? '0x') as Hex,
      status: 'live',
      alreadyDeployed: true,
    };
  }

  const bundlerClient = createBundlerClient({
    chain: arcTestnet,
    transport: modular,
    paymaster: true,
    userOperation: {
      // Arc Testnet bundler precheck: maxPriorityFeePerGas >= 1 gwei.
      // viem's default estimate returns sub-gwei values that get
      // rejected. Override to the chain's documented floor.
      estimateFeesPerGas: async () => ({
        maxFeePerGas: ARC_MIN_PRIORITY_FEE_PER_GAS * 2n,
        maxPriorityFeePerGas: ARC_MIN_PRIORITY_FEE_PER_GAS,
      }),
    },
  });

  // Bootstrap call: no-op self-call. Triggers the lazy create2 via
  // factoryArgs without doing anything else. Multi-owner install
  // ships in Phase 7.5.x.yy as a SEPARATE userOp.
  let userOpHash: Hex;
  try {
    userOpHash = await bundlerClient.sendUserOperation({
      account,
      calls: [{ to: account.address, value: 0n, data: '0x' }],
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
    // Don't abort — the userOp may still confirm async. Persist the
    // hash with status='pending' so the operator can re-run to
    // reconcile, and surface the error.
    await prisma.superOrgTreasury.update({
      where: { id: treasury.id },
      data: { provisioningTxRef: userOpHash },
    });
    return {
      ok: false,
      error: `Submitted (userOpHash=${userOpHash}) but receipt poll timed out: ${err instanceof Error ? err.message : String(err)}. Re-run to reconcile.`,
    };
  }

  await prisma.superOrgTreasury.update({
    where: { id: treasury.id },
    data: {
      status: 'live',
      provisioningTxRef: userOpHash,
    },
  });

  return {
    ok: true,
    treasuryId: treasury.id,
    address: account.address,
    userOpHash,
    status: 'live',
    alreadyDeployed: false,
  };
}
