/**
 * Inline mint of the seeded BoardingPass NFT — bypasses WDK so we can
 * verify the on-chain pipeline (Circle DCW → SenderoStamps → Arcscan tx)
 * without the workflow runtime.
 *
 * Usage: bun run scripts/mint-boarding-pass-now.ts <tripId> <bookingId>
 */
import { mintStampTool } from '@sendero/tools/mint-stamp';
import { prisma } from '@sendero/database';

const [tripId, bookingId] = process.argv.slice(2);
if (!tripId || !bookingId) {
  console.error('Usage: bun run scripts/mint-boarding-pass-now.ts <tripId> <bookingId>');
  process.exit(1);
}

const trip = await prisma.trip.findUnique({
  where: { id: tripId },
  select: {
    travelerId: true,
    tenant: { select: { slug: true } },
    traveler: {
      select: {
        wallets: {
          where: { provisioner: 'dcw', chainId: 5042002 },
          select: { address: true },
          take: 1,
        },
      },
    },
  },
});
if (!trip?.traveler?.wallets[0]?.address) throw new Error(`No DCW wallet for trip ${tripId}`);

const stamp = await prisma.nftStamp.findUnique({
  where: { kind_primaryKey: { kind: 'BoardingPass', primaryKey: bookingId } },
});
if (!stamp) throw new Error(`No NftStamp row for bookingId ${bookingId}`);
if (stamp.status === 'minted') {
  console.log(`Already minted: tokenId=${stamp.tokenId}, tx=${stamp.mintTxHash}`);
  process.exit(0);
}

console.log(
  `[mint] tenant=${trip.tenant.slug} to=${trip.traveler.wallets[0].address} uri=${stamp.uri}`
);

const result = await mintStampTool.handler({
  kind: 'BoardingPass',
  primaryKey: bookingId,
  to: trip.traveler.wallets[0].address,
  uri: stamp.uri,
  tenantSlug: trip.tenant.slug,
  quantity: 1,
  tripId,
  bookingId,
  travelerId: trip.travelerId ?? undefined,
  blobUrl: stamp.blobUrl ?? undefined,
  caption: stamp.caption ?? undefined,
  metadata: (stamp.metadata as Record<string, unknown>) ?? undefined,
});

console.log(JSON.stringify(result, null, 2));
console.log(`Arcscan: https://arc-sepolia.explorer.alchemy.com/tx/${result.txHash}`);
process.exit(0);
