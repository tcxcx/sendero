/**
 * Resolve the Sendero-platform treasury destination for cost-
 * reimbursement settlements. Single source of truth for "where do
 * traveler-side spends settle to" so book-flight (and future settle
 * paths) stay aligned with whatever the platform-treasury admin panel
 * provisioned.
 *
 * Resolution order:
 *   1. Live `SuperOrgTreasury` row for the requested chain
 *      (status='live', multisigAddress set). The admin panel at
 *      /dashboard/treasury writes these — when ops have provisioned
 *      a multisig for the chain, that's the canonical destination.
 *   2. Env var fallback (`TREASURY_VIEM_ADDRESS` for arc/EVM chains).
 *      Kept so dev environments without an admin-panel-provisioned
 *      treasury still settle to a known wallet.
 *   3. Null — caller MUST refuse to settle (the legacy guard the env-
 *      var-only path used to enforce). Settlements without a known
 *      recipient lose money.
 */

import { prisma } from '@sendero/database';

export type PlatformTreasuryChain = 'arc' | 'sol';

export interface PlatformTreasuryDestination {
  /** Wallet address the spend should target. EVM hex on Arc; base58
   *  on Solana. */
  address: string;
  /** SuperOrgTreasury.id when sourced from the admin panel; null when
   *  resolved from env-var fallback (no DB row exists). */
  treasuryId: string | null;
  /** Network identifier matching CircleWallet.chain — 'arc-testnet',
   *  'arc-mainnet', 'sol-devnet', 'sol-mainnet'. Useful for explorer
   *  links + cross-table joins. */
  network: string;
  /** Where the value came from. `'admin'` = live SuperOrgTreasury row,
   *  `'env'` = TREASURY_VIEM_ADDRESS fallback. */
  source: 'admin' | 'env';
}

/**
 * Resolve the platform treasury destination for the given chain.
 *
 * Returns null when neither the admin panel nor the env var have a
 * value — the caller MUST refuse to settle in that case.
 *
 * For Solana, fall back to `SENDERO_SOLANA_TREASURY_ADDRESS` env var
 * (matches `apps/app/lib/nanopay-settle.ts::makeSolanaSettleFn`) so
 * dev environments without an admin-panel-provisioned Squads vault
 * still settle to a known wallet.
 */
export async function resolvePlatformTreasuryDestination(
  chain: PlatformTreasuryChain
): Promise<PlatformTreasuryDestination | null> {
  // Admin-panel resolution: prefer the most recently created LIVE row
  // for the chain. The admin-panel creates rows in 'pending' first;
  // we only treat 'live' as a legitimate destination.
  try {
    const live = await prisma.superOrgTreasury.findFirst({
      where: { chain, status: 'live' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        network: true,
        vaultAddress: true,
        multisigAddress: true,
      },
    });
    if (live?.vaultAddress) {
      return {
        address: live.vaultAddress,
        treasuryId: live.id,
        network: live.network,
        source: 'admin',
      };
    }
  } catch (err) {
    // DB unreachable / Prisma client mismatch — fall through to env.
    console.warn('[platform-treasury] admin-panel lookup failed, falling back to env', {
      chain,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  if (chain === 'arc') {
    const envAddress = process.env.TREASURY_VIEM_ADDRESS;
    if (envAddress) {
      return {
        address: envAddress,
        treasuryId: null,
        network: 'arc-testnet',
        source: 'env',
      };
    }
  }

  if (chain === 'sol') {
    const envAddress = process.env.SENDERO_SOLANA_TREASURY_ADDRESS;
    if (envAddress) {
      return {
        address: envAddress,
        treasuryId: null,
        network: 'sol-devnet',
        source: 'env',
      };
    }
  }

  return null;
}

/**
 * Resolve the platform treasury for a tenant. Reads `Tenant.primaryChain`
 * to pick between Arc and Solana. Use this from settle paths that need
 * to honor the tenant's chain selection (book-flight settlement,
 * commission splits, etc.).
 */
export async function resolveTenantPlatformTreasury(
  tenantId: string
): Promise<PlatformTreasuryDestination | null> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { primaryChain: true },
  });
  const chain: PlatformTreasuryChain = tenant?.primaryChain === 'sol' ? 'sol' : 'arc';
  return resolvePlatformTreasuryDestination(chain);
}
