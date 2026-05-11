/**
 * Per-tenant Solana treasury wallet provisioning — programmatic, via
 * Circle DCW. Phase 4.x.y.
 *
 * Mirrors `provisionTenantWallet` (Arc) and `provisionTenantOpsDcw`
 * (per-chain ops): one tenant, one Solana DCW EOA, persisted as
 * `CircleWallet { kind: 'treasury', chain: 'SOL-DEVNET' }`. Idempotent
 * on `(tenantId, kind='treasury', chain='SOL-DEVNET')` so the Clerk
 * webhook + the retry sweeper can both call it safely.
 *
 * Why a separate function instead of widening `provisionTenantWallet`:
 *   - Arc treasury is a Circle SCA (gas-sponsored via Gas Station).
 *   - Solana treasury is a Circle EOA (Solana has no SCA support in
 *     Circle DCW; gas comes from Sendero's Solana platform wallet
 *     via the JIT-drip pattern documented in CLAUDE.md).
 *
 * Different `accountType`, different gas model, different downstream
 * spend semantics. A `chain` parameter on `provisionTenantWallet`
 * would conflate two genuinely different code paths.
 *
 * Reuses the tenant's existing `circleWalletSetId` when one exists
 * (from a prior Arc or ops provisioning) so Circle wallet grouping
 * stays coherent per tenant.
 */

import { prisma } from '@sendero/database';

import { syncCircleWalletSet, type SyncCircleSdk } from './sync-wallet-set';

export interface ProvisionTenantSolanaTreasuryArgs {
  tenantId: string;
  clerkOrgId: string;
  /** Defaults to SOL-DEVNET. Override for mainnet promotion. */
  chain?: 'SOL-DEVNET' | 'SOL';
  /** Optional SDK injection for testing. */
  sdk?: SolanaTreasurySdk;
}

export interface SolanaTreasurySdk {
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
  listWallets?: SyncCircleSdk['listWallets'];
}

export interface ProvisionTenantSolanaTreasuryResult {
  walletSetId: string;
  walletId: string;
  /** Solana base58 pubkey. NOT lowercased (Solana addresses are case-sensitive). */
  address: string;
  alreadyExisted: boolean;
  chain: 'SOL-DEVNET' | 'SOL';
}

export async function provisionTenantSolanaTreasury(
  args: ProvisionTenantSolanaTreasuryArgs
): Promise<ProvisionTenantSolanaTreasuryResult> {
  const chain = args.chain ?? 'SOL-DEVNET';

  // Idempotent — return existing row if present.
  const existing = await prisma.circleWallet.findFirst({
    where: { tenantId: args.tenantId, kind: 'treasury', chain },
  });
  if (existing) {
    return {
      walletSetId: existing.circleWalletSetId ?? '',
      walletId: existing.circleWalletId ?? '',
      address: existing.address,
      alreadyExisted: true,
      chain,
    };
  }

  const sdk = args.sdk ?? (await resolveSdk());

  // Reuse any existing tenant walletSet (Arc treasury, ops, etc.).
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

  // Solana DCW must be EOA — Circle doesn't support SCA on Solana.
  const wRes = await sdk.createWallets({
    walletSetId,
    blockchains: [chain],
    count: 1,
    accountType: 'EOA',
  });
  const wallet = wRes.data?.wallets?.[0];
  if (!wallet?.address) {
    throw new Error(`circle Solana treasury wallet creation returned no address (chain=${chain})`);
  }

  // Race-safe double-check.
  const winner = await prisma.circleWallet.findFirst({
    where: { tenantId: args.tenantId, kind: 'treasury', chain },
  });
  if (winner) {
    return {
      walletSetId: winner.circleWalletSetId ?? '',
      walletId: winner.circleWalletId ?? '',
      address: winner.address,
      alreadyExisted: true,
      chain,
    };
  }

  await prisma.circleWallet.create({
    data: {
      tenantId: args.tenantId,
      clerkOrgId: args.clerkOrgId,
      // Solana base58 — case sensitive, do NOT lowercase.
      address: wallet.address,
      kind: 'treasury',
      chain,
      circleWalletSetId: walletSetId,
      circleWalletId: wallet.id,
    },
  });

  // Best-effort sync of any other-chain wallets in the set.
  if (sdk.listWallets) {
    try {
      await syncCircleWalletSet({
        tenantId: args.tenantId,
        clerkOrgId: args.clerkOrgId,
        walletSetId,
        sdk: { listWallets: sdk.listWallets },
      });
    } catch (err) {
      console.warn('[provisionTenantSolanaTreasury] post-create sync failed (non-fatal)', {
        tenantId: args.tenantId,
        walletSetId,
        chain,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    walletSetId,
    walletId: wallet.id,
    address: wallet.address,
    alreadyExisted: false,
    chain,
  };
}

async function resolveSdk(): Promise<SolanaTreasurySdk> {
  try {
    const mod = await import('./wallets');
    if ('getCircle' in mod && typeof (mod as { getCircle?: unknown }).getCircle === 'function') {
      const circle = (mod as { getCircle: () => unknown }).getCircle() as {
        createWalletSet: SolanaTreasurySdk['createWalletSet'];
        createWallets: SolanaTreasurySdk['createWallets'];
        listWallets: NonNullable<SolanaTreasurySdk['listWallets']>;
      };
      return {
        createWalletSet: a => circle.createWalletSet(a),
        createWallets: a => circle.createWallets(a),
        listWallets: a => circle.listWallets(a),
      };
    }
  } catch {
    // fall through
  }
  throw new Error(
    'provisionTenantSolanaTreasury: cannot resolve a Circle SDK. Pass `sdk` explicitly or ensure @sendero/circle/wallets exports getCircle().'
  );
}
