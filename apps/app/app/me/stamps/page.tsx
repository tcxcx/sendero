/**
 * `/me/stamps` — traveler's NFT stamp collection.
 *
 * Filtered by `NftStamp.travelerId === user.id`. Each entry links to
 * the canonical public stamp page (`/stamps/[tokenId]`) which already
 * renders the framed share card.
 */

import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import Image from 'next/image';

import { prisma } from '@sendero/database';

import {
  EmptyStateCard,
  Stat,
  StatGrid,
  TravelerSurface,
  TravelerSurfaceHeader,
} from '@/components/traveler/traveler-surface';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function TravelerStampsPage() {
  const { userId } = await auth();
  if (!userId) return null;

  const user = await prisma.user.findUnique({
    where: { clerkUserId: userId },
    select: { id: true },
  });
  if (!user) return null;

  const [stamps, kinds, latest] = await Promise.all([
    prisma.nftStamp.findMany({
      where: { travelerId: user.id, status: 'minted' },
      orderBy: { mintedAt: 'desc' },
      take: 50,
      select: {
        id: true,
        kind: true,
        tokenId: true,
        blobUrl: true,
        caption: true,
        mintedAt: true,
        tenant: { select: { displayName: true } },
      },
    }),
    prisma.nftStamp.groupBy({
      by: ['kind'],
      where: { travelerId: user.id, status: 'minted' },
      _count: { _all: true },
    }),
    prisma.nftStamp.findFirst({
      where: { travelerId: user.id, status: 'minted' },
      orderBy: { mintedAt: 'desc' },
      select: { mintedAt: true },
    }),
  ]);

  const totalStamps = kinds.reduce((s, k) => s + k._count._all, 0);
  const distinctKinds = kinds.length;
  const latestText = latest?.mintedAt
    ? new Date(latest.mintedAt).toLocaleDateString()
    : '—';

  return (
    <TravelerSurface>
      <TravelerSurfaceHeader
        title="Your stamps"
        subhead="On-chain souvenirs minted across the lifecycle of every trip — boarding pass, settlement receipt, itinerary map, trip passport."
      />

      <StatGrid>
        <Stat label="Stamps" value={String(totalStamps)} />
        <Stat label="Kinds" value={String(distinctKinds)} />
        <Stat label="Latest" value={latestText} />
        <Stat label="Network" value="Arc-Testnet" />
      </StatGrid>

      {stamps.length === 0 ? (
        <EmptyStateCard
          title="No stamps yet."
          body="Complete a booking and your boarding-pass NFT mints to your wallet automatically. Refreshable kinds (itinerary map) update in place; everything else is append-only."
        />
      ) : (
        <section className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          {stamps.map(s => (
            <Link
              key={s.id}
              href={`/stamps/${s.tokenId}`}
              className="flex flex-col gap-2 rounded-xl border border-border p-4 hover:bg-muted/40"
            >
              {s.blobUrl ? (
                <div className="relative aspect-square w-full overflow-hidden rounded-md bg-muted/40">
                  <Image
                    src={s.blobUrl}
                    alt={s.kind}
                    fill
                    sizes="(min-width: 640px) 360px, 100vw"
                  />
                </div>
              ) : (
                <div className="aspect-square w-full rounded-md bg-muted/40" />
              )}
              <div className="flex flex-col gap-1">
                <p className="font-display text-sm">{s.kind}</p>
                <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                  {s.tenant.displayName} · token #{s.tokenId}
                </p>
                {s.caption ? <p className="text-xs leading-snug">{s.caption}</p> : null}
              </div>
            </Link>
          ))}
        </section>
      )}
    </TravelerSurface>
  );
}
