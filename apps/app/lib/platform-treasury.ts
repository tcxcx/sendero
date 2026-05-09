import { prisma } from '@sendero/database';

export type PlatformTreasuryChain = 'arc' | 'sol';

export interface PlatformTreasuryDestination {
  chain: PlatformTreasuryChain;
  network: string;
  address: string;
  treasuryId: string;
}

/**
 * Resolve the live Sendero platform treasury destination from the
 * admin-provisioned SuperOrgTreasury record. Settlement code should not
 * pay legacy env EOAs once the admin treasury exists.
 */
export async function resolvePlatformTreasuryDestination(
  chain: PlatformTreasuryChain
): Promise<PlatformTreasuryDestination | null> {
  const row = await prisma.superOrgTreasury.findFirst({
    where: { chain, status: 'live' },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      network: true,
      vaultAddress: true,
    },
  });

  if (!row?.vaultAddress) return null;
  return {
    chain,
    network: row.network,
    address: row.vaultAddress,
    treasuryId: row.id,
  };
}

export async function requirePlatformTreasuryDestination(
  chain: PlatformTreasuryChain,
  caller: string
): Promise<PlatformTreasuryDestination> {
  const destination = await resolvePlatformTreasuryDestination(chain);
  if (!destination) {
    throw new Error(
      `[${caller}] No live ${chain} platform treasury is provisioned. Finish Sendero admin treasury setup before settling funds.`
    );
  }
  return destination;
}
