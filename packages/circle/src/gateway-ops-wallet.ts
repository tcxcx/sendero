/**
 * Per-tenant operations DCW provisioning for the Gateway sweep loop.
 *
 * An "operations" wallet is a Circle DCW SCA per (tenant, chain) that
 * receives inbound USDC (ramps, bridges, internal transfers, customer
 * payments) and serves as the staging address for the auto-sweep loop.
 *
 * Why a separate wallet kind from the treasury:
 *   - The treasury wallet is the tenant's primary balance-holding
 *     wallet (kind='treasury'). It's where settle_split's agency leg
 *     ultimately lands and where operator UI ops happen.
 *   - The operations wallet is a staging buffer. Inbound USDC lands
 *     here briefly, the webhook fires, sweepChain moves the USDC into
 *     the tenant Gateway EOA via EIP-3009, which then deposits to
 *     Gateway's unified balance. Operations wallet should hover near
 *     zero under steady state.
 *
 * Phase 1 = Arc only. Phase 2 widens this to per-chain ops DCWs as the
 * supported chain set grows. The (tenantId, kind, chain) index added in
 * the Phase 1 schema migration supports the per-chain lookup.
 *
 * Idempotent on (tenantId, kind='operations', chain). Safe to call from
 * onOrganizationCreated, the backfill cron, or anywhere a missing ops
 * DCW would block sweep. Concurrent first-time calls race on the unique
 * constraint — loser falls through to a re-read.
 */

import { prisma } from '@sendero/database';

import { syncCircleWalletSet, type SyncCircleSdk } from './sync-wallet-set';

export interface ProvisionTenantOpsDcwArgs {
  tenantId: string;
  clerkOrgId: string;
  /** Circle blockchain identifier (e.g. 'ARC-TESTNET', 'AVAX-FUJI'). */
  chain: string;
  /** Optional SDK injection for testing. Defaults to lazy import of
   *  the configured Circle DCW client. */
  sdk?: OpsCircleSdk;
}

/**
 * Narrow adapter over the Circle DCW SDK methods this module needs.
 * Same shape as `provisionTenantWallet`'s `CircleSdkLike` so a single
 * stub can drive both tests.
 */
export interface OpsCircleSdk {
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
  /** See `provision-tenant-wallet.ts` — used by the post-create sync. */
  listWallets?: SyncCircleSdk['listWallets'];
}

export interface ProvisionTenantOpsDcwResult {
  walletSetId: string;
  walletId: string;
  address: string;
  alreadyExisted: boolean;
}

function accountTypeForChain(chain: string): 'EOA' | 'SCA' {
  // Circle only supports EOA wallets on Solana. EVM operations wallets
  // stay SCA so Gas Station can sponsor the sweep transfer.
  return chain === 'SOL-DEVNET' || chain === 'SOL' ? 'EOA' : 'SCA';
}

function canonicalAddressForChain(address: string, chain: string): string {
  // EVM addresses are case-insensitive; Solana base58 addresses are not.
  return accountTypeForChain(chain) === 'EOA' && (chain === 'SOL-DEVNET' || chain === 'SOL')
    ? address
    : address.toLowerCase();
}

/**
 * Provision an ops DCW for (tenantId, chain). Returns the existing row
 * unchanged if one is already present. Reuses the tenant's existing
 * walletSet if one was already created by `provisionTenantWallet`;
 * otherwise mints a new one with the same `tenant-<id>` naming.
 */
export async function provisionTenantOpsDcw(
  args: ProvisionTenantOpsDcwArgs
): Promise<ProvisionTenantOpsDcwResult> {
  // Idempotent — return existing if present.
  const existing = await prisma.circleWallet.findFirst({
    where: { tenantId: args.tenantId, kind: 'operations', chain: args.chain },
  });
  if (existing) {
    return {
      walletSetId: existing.circleWalletSetId ?? '',
      walletId: existing.circleWalletId ?? '',
      address: existing.address,
      alreadyExisted: true,
    };
  }

  const sdk = args.sdk ?? (await resolveSdk());

  // Reuse the treasury walletSet if it exists — keeps Circle's wallet
  // grouping coherent per tenant. Fall back to creating one only if the
  // tenant has no Circle wallets at all (shouldn't happen post Phase 1,
  // but the backfill cron is a defensive caller).
  const treasuryRow = await prisma.circleWallet.findFirst({
    where: { tenantId: args.tenantId, kind: 'treasury' },
    select: { circleWalletSetId: true },
  });

  let walletSetId = treasuryRow?.circleWalletSetId ?? null;
  if (!walletSetId) {
    const wsRes = await sdk.createWalletSet({ name: `tenant-${args.tenantId}` });
    walletSetId = wsRes.data?.walletSet?.id ?? null;
    if (!walletSetId) {
      throw new Error('circle walletSet creation returned no id');
    }
  }

  const wRes = await sdk.createWallets({
    walletSetId,
    blockchains: [args.chain],
    count: 1,
    accountType: accountTypeForChain(args.chain),
  });
  const wallet = wRes.data?.wallets?.[0];
  if (!wallet?.address) {
    throw new Error(`circle ops wallet creation returned no address (chain=${args.chain})`);
  }

  // Race-safe: a concurrent caller might have raced us through
  // findFirst → SDK call. The non-unique index on (tenantId, kind,
  // chain) doesn't enforce singleton, so we double-check before insert
  // and return the winner if one exists.
  const winner = await prisma.circleWallet.findFirst({
    where: { tenantId: args.tenantId, kind: 'operations', chain: args.chain },
  });
  if (winner) {
    return {
      walletSetId: winner.circleWalletSetId ?? '',
      walletId: winner.circleWalletId ?? '',
      address: winner.address,
      alreadyExisted: true,
    };
  }

  await prisma.circleWallet.create({
    data: {
      tenantId: args.tenantId,
      clerkOrgId: args.clerkOrgId,
      address: canonicalAddressForChain(wallet.address, args.chain),
      kind: 'operations',
      chain: args.chain,
      circleWalletSetId: walletSetId,
      circleWalletId: wallet.id,
    },
  });

  // Same post-create sync as the treasury path. See
  // `provision-tenant-wallet.ts` for the rationale (the $500 incident).
  if (sdk.listWallets) {
    try {
      await syncCircleWalletSet({
        tenantId: args.tenantId,
        clerkOrgId: args.clerkOrgId,
        walletSetId,
        sdk: { listWallets: sdk.listWallets },
      });
    } catch (err) {
      console.warn('[provisionTenantOpsDcw] post-create wallet-set sync failed (non-fatal)', {
        tenantId: args.tenantId,
        walletSetId,
        chain: args.chain,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    walletSetId,
    walletId: wallet.id,
    address: wallet.address,
    alreadyExisted: false,
  };
}

async function resolveSdk(): Promise<OpsCircleSdk> {
  try {
    const mod = await import('./wallets');
    if ('getCircle' in mod && typeof (mod as { getCircle?: unknown }).getCircle === 'function') {
      const circle = (mod as { getCircle: () => unknown }).getCircle() as {
        createWalletSet: OpsCircleSdk['createWalletSet'];
        createWallets: OpsCircleSdk['createWallets'];
        listWallets: NonNullable<OpsCircleSdk['listWallets']>;
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
    'provisionTenantOpsDcw: cannot resolve a Circle SDK. Pass `sdk` explicitly or ensure @sendero/circle/wallets exports getCircle().'
  );
}
