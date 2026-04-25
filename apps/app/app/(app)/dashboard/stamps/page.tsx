/**
 * /dashboard/stamps — signed-in traveler-facing collection grid.
 *
 * Renders the user's NFT stamp ownerships across all tenants they
 * travel for. Backed by Postgres (`NftStampOwnership` joined to
 * `NftStamp`), populated by the Circle Event Monitor webhook at
 * `/api/webhooks/circle/events` — Ponder is intentionally NOT in
 * the loop here.
 *
 * Empty state nudges the user to book a flight so the first
 * BoardingPass workflow fires.
 */

import Image from 'next/image';
import Link from 'next/link';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

import { prisma } from '@sendero/database';

const ARC_TESTNET_CHAIN_ID = 5042002;

const KIND_LABELS: Record<string, string> = {
  BoardingPass: 'Boarding Pass',
  SettlementReceipt: 'Settlement Receipt',
  ItineraryMap: 'Itinerary Map',
  TripPassport: 'Trip Passport',
};

interface StampGridItem {
  stampId: string;
  tokenId: string;
  primaryKey: string;
  kind: string;
  caption: string | null;
  blobUrl: string | null;
  tenantSlug: string;
  tenantName: string;
  balance: number;
  mintedAt: string | null;
}

export default async function StampsCollectionPage() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');

  const user = await prisma.user.findUnique({
    where: { clerkUserId },
    select: {
      id: true,
      wallets: {
        where: { provisioner: 'dcw', chainId: ARC_TESTNET_CHAIN_ID },
        select: { address: true },
      },
    },
  });
  if (!user) redirect('/onboarding');

  const addresses = user.wallets.map(w => w.address.toLowerCase());

  // Pull ownerships either by FK (preferred — webhook resolved owner →
  // user) or by the raw address list (fallback — webhook arrived
  // before the user's DCW row was indexed). Either signal counts.
  const ownerships = await prisma.nftStampOwnership.findMany({
    where: {
      AND: [
        { balance: { gt: 0 } },
        {
          OR: [
            { ownerUserId: user.id },
            ...(addresses.length > 0 ? [{ ownerAddress: { in: addresses } }] : []),
          ],
        },
      ],
    },
    select: {
      balance: true,
      stamp: {
        select: {
          id: true,
          tokenId: true,
          primaryKey: true,
          kind: true,
          caption: true,
          blobUrl: true,
          tenantSlug: true,
          mintedAt: true,
          tenant: { select: { displayName: true } },
        },
      },
    },
    orderBy: { updatedAt: 'desc' },
    take: 120,
  });

  const items: StampGridItem[] = ownerships
    .filter(o => o.stamp)
    .map(o => ({
      stampId: o.stamp.id,
      tokenId: o.stamp.tokenId,
      primaryKey: o.stamp.primaryKey,
      kind: o.stamp.kind,
      caption: o.stamp.caption,
      blobUrl: o.stamp.blobUrl,
      tenantSlug: o.stamp.tenantSlug,
      tenantName: o.stamp.tenant.displayName,
      balance: Number(o.balance),
      mintedAt: o.stamp.mintedAt?.toISOString() ?? null,
    }));

  return (
    <main className="mx-auto flex w-full max-w-[1080px] flex-col gap-8 px-6 py-10">
      <header className="flex flex-col gap-1">
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Sendero × Arc</p>
        <h1 className="font-display text-3xl">Your trip stamps</h1>
        <p className="text-sm text-muted-foreground">
          NFT collectibles minted to your travel wallet on Arc-Testnet — one for every confirmed
          flight, settled invoice, and completed trip.
        </p>
      </header>

      {items.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {items.map(item => (
            <li key={item.stampId}>
              <Link
                href={`/stamps/${item.primaryKey}`}
                className="group block overflow-hidden rounded-2xl border border-border bg-card transition hover:border-foreground/40"
              >
                <div className="relative aspect-square w-full bg-muted">
                  {item.blobUrl ? (
                    <Image
                      src={item.blobUrl}
                      alt={KIND_LABELS[item.kind] ?? item.kind}
                      fill
                      sizes="(min-width: 1024px) 240px, (min-width: 640px) 50vw, 100vw"
                      className="object-cover transition group-hover:scale-[1.02]"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                      Generating…
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-1 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                    {KIND_LABELS[item.kind] ?? item.kind}
                  </p>
                  <p className="line-clamp-2 text-sm text-foreground">
                    {item.caption ?? `A ${item.tenantName} stamp.`}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {item.tenantName}
                    {item.balance > 1 ? ` · ×${item.balance}` : ''}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-muted/30 px-6 py-16 text-center">
      <p className="font-display text-xl">Your first stamp will land here.</p>
      <p className="mt-2 text-sm text-muted-foreground">
        Book a flight and we'll mint a Boarding Pass NFT to your travel wallet the moment it
        confirms.
      </p>
      <Link
        href="/dashboard/console"
        className="mt-6 inline-block rounded-md bg-foreground px-4 py-2 text-sm text-background hover:opacity-90"
      >
        Plan a trip
      </Link>
    </div>
  );
}
