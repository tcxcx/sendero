/**
 * Provision a Circle walletSet + wallet for a Clerk organization (tenant).
 *
 * Phase-11c1. Called from:
 *   - the Clerk webhook handler on `organization.created`
 *   - a retry cron for transient failures
 *
 * Persists to the tenant-scoped `CircleWallet` Prisma model (separate from
 * the user-scoped `Wallet` model). Idempotent on `tenantId` + `kind=treasury`:
 * a second call with the same tenant returns the existing row without
 * calling Circle again.
 */

import { prisma } from '@sendero/database';

export interface ProvisionTenantWalletArgs {
  tenantId: string;
  clerkOrgId: string;
  /**
   * Optional SDK injection — useful for testing. Defaults to a lazy
   * import of the repo's configured Circle DCW client from `./wallets`
   * (`getCircle`), wrapped to match `CircleSdkLike`.
   */
  sdk?: CircleSdkLike;
}

/**
 * Narrow adapter over Circle DCW SDK methods we need. Keeping this
 * interface small makes testing trivial (no SDK mocking gymnastics)
 * and lets us swap implementations without rippling types.
 */
export interface CircleSdkLike {
  createWalletSet: (args: { name: string }) => Promise<{
    data?: { walletSet?: { id: string } };
  }>;
  createWallets: (args: {
    walletSetId: string;
    blockchains: string[];
    count?: number;
    accountType?: string;
  }) => Promise<{
    data?: { wallets?: Array<{ id: string; address: string }> };
  }>;
}

export interface ProvisionTenantWalletResult {
  walletSetId: string;
  walletId: string;
  address: `0x${string}`;
  alreadyExisted: boolean;
}

export async function provisionTenantWallet(
  args: ProvisionTenantWalletArgs
): Promise<ProvisionTenantWalletResult> {
  // Idempotent — return existing if present.
  const existing = await prisma.circleWallet.findFirst({
    where: { tenantId: args.tenantId, kind: 'treasury' },
  });
  if (existing) {
    return {
      walletSetId: existing.circleWalletSetId ?? '',
      walletId: existing.circleWalletId ?? '',
      address: existing.address as `0x${string}`,
      alreadyExisted: true,
    };
  }

  const sdk = args.sdk ?? (await resolveSdk());

  // 1. Reuse the tenant walletSet when operations wallets already
  // exist. Otherwise create the walletSet (Circle groups wallets by set).
  const existingWalletSet = await prisma.circleWallet.findFirst({
    where: { tenantId: args.tenantId, circleWalletSetId: { not: null } },
    select: { circleWalletSetId: true },
    orderBy: { createdAt: 'asc' },
  });
  let walletSetId = existingWalletSet?.circleWalletSetId ?? null;
  if (!walletSetId) {
    const wsRes = await sdk.createWalletSet({ name: `tenant-${args.tenantId}` });
    walletSetId = wsRes.data?.walletSet?.id ?? null;
    if (!walletSetId) {
      throw new Error('circle walletSet creation returned no id');
    }
  }

  // 2. Create an SCA wallet on Arc Testnet inside the walletSet.
  const wRes = await sdk.createWallets({
    walletSetId,
    blockchains: ['ARC-TESTNET'],
    count: 1,
    accountType: 'SCA',
  });
  const wallet = wRes.data?.wallets?.[0];
  if (!wallet?.address) {
    throw new Error('circle wallet creation returned no address');
  }

  // 3. Persist — addresses stored lowercased for canonical equality.
  await prisma.circleWallet.create({
    data: {
      tenantId: args.tenantId,
      clerkOrgId: args.clerkOrgId,
      address: wallet.address.toLowerCase(),
      kind: 'treasury',
      chain: 'ARC-TESTNET',
      circleWalletSetId: walletSetId,
      circleWalletId: wallet.id,
    },
  });

  return {
    walletSetId,
    walletId: wallet.id,
    address: wallet.address as `0x${string}`,
    alreadyExisted: false,
  };
}

/**
 * Default SDK resolver: wraps `getCircle()` from `./wallets` (the DCW
 * client used for treasury ops) to the narrow `CircleSdkLike` contract.
 *
 * Tests inject their own SDK and bypass this path entirely.
 */
async function resolveSdk(): Promise<CircleSdkLike> {
  try {
    const mod = await import('./wallets');
    if ('getCircle' in mod && typeof (mod as { getCircle?: unknown }).getCircle === 'function') {
      const circle = (mod as { getCircle: () => unknown }).getCircle() as {
        createWalletSet: CircleSdkLike['createWalletSet'];
        createWallets: CircleSdkLike['createWallets'];
      };
      return {
        createWalletSet: a => circle.createWalletSet(a),
        createWallets: a => circle.createWallets(a),
      };
    }
  } catch {
    // fall through
  }
  throw new Error(
    'provisionTenantWallet: cannot resolve a Circle SDK. Pass `sdk` explicitly or ensure @sendero/circle/wallets exports getCircle().'
  );
}
