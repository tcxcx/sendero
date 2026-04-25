/**
 * Server-side loader for the public stamp page.
 *
 * Looks up an `NftStamp` by either the on-chain tokenId (decimal
 * string) OR by domain primaryKey (bookingId / tripId). The OG URL
 * users share is `app.sendero.travel/stamps/<primaryKey>` because the
 * tokenId isn't known until after mint, but we also accept the
 * tokenId for direct-from-Arcscan deep links.
 *
 * Cached for 5 minutes — Slack re-fetches the page once an hour, but
 * a stamp's metadata is immutable post-mint so we could go higher.
 * Five minutes leaves room for the rare `refresh_stamp_uri` case.
 */

import { unstable_cache } from 'next/cache';

import { prisma } from '@sendero/database';

export interface StampForOg {
  tokenId: string;
  contract: string;
  kind: string;
  primaryKey: string;
  name: string;
  caption: string;
  blobUrl: string;
  ipfsUri: string;
  tenantSlug: string;
  tenantDisplayName: string | null;
  /** ISO string for the stamped-on date. */
  mintedAt: string | null;
  /** ERC-1155 metadata `attributes` array (route, carrier, etc.). */
  attributes: Array<{ trait_type: string; value: string | number }>;
}

const KIND_LABELS: Record<string, string> = {
  BoardingPass: 'Boarding Pass',
  SettlementReceipt: 'Settlement Receipt',
  ItineraryMap: 'Itinerary Map',
  TripPassport: 'Trip Passport',
};

export const loadStampForOg = unstable_cache(
  async (lookup: string): Promise<StampForOg | null> => {
    const where = isNumericString(lookup) ? { tokenId: lookup } : { primaryKey: lookup };

    const row = await prisma.nftStamp.findFirst({
      where: { ...where, status: { in: ['minted', 'refreshed'] } },
      select: {
        tokenId: true,
        contract: true,
        kind: true,
        primaryKey: true,
        caption: true,
        blobUrl: true,
        uri: true,
        tenantSlug: true,
        mintedAt: true,
        metadata: true,
        tenant: { select: { displayName: true } },
      },
    });
    if (!row || !row.blobUrl) return null;

    const metadata = (row.metadata ?? {}) as Record<string, unknown>;
    const route = typeof metadata.route === 'string' ? metadata.route : null;
    const attributes: StampForOg['attributes'] = [
      { trait_type: 'Kind', value: row.kind },
      { trait_type: 'Tenant', value: row.tenant.displayName },
    ];
    if (route) attributes.push({ trait_type: 'Route', value: route });

    return {
      tokenId: row.tokenId,
      contract: row.contract,
      kind: row.kind,
      primaryKey: row.primaryKey,
      name: `${KIND_LABELS[row.kind] ?? row.kind}${route ? ` · ${route}` : ''}`,
      caption: row.caption ?? `A Sendero ${KIND_LABELS[row.kind] ?? row.kind} stamp.`,
      blobUrl: row.blobUrl,
      ipfsUri: row.uri,
      tenantSlug: row.tenantSlug,
      tenantDisplayName: row.tenant.displayName,
      mintedAt: row.mintedAt?.toISOString() ?? null,
      attributes,
    };
  },
  ['stamp-og'],
  { revalidate: 300, tags: ['stamps'] }
);

function isNumericString(s: string): boolean {
  return /^\d+$/.test(s);
}
