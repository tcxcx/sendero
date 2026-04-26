/**
 * Public stamp page — the canonical OG unfurl target.
 *
 * Lives outside the `(app)` segment, allow-listed in `proxy.ts`, so
 * Slackbot / WhatsApp / X can fetch it without a Clerk session. The
 * `generateMetadata` export is the OG payload; the page body renders
 * for direct visitors after they click through the unfurl.
 *
 * Lookup accepts either the on-chain tokenId (decimal) or the domain
 * primaryKey (bookingId / tripId) — same loader, same OG output.
 */

import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { loadStampForOg } from '@/lib/stamp-og';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface PageParams {
  tokenId: string;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { tokenId } = await params;
  const stamp = await loadStampForOg(tokenId);
  if (!stamp) {
    return { title: 'Stamp not found · Sendero' };
  }
  const url = `https://app.sendero.travel/stamps/${stamp.primaryKey}`;
  return {
    title: `${stamp.name} · Sendero`,
    description: stamp.caption,
    // No explicit openGraph.images / twitter.images here — Next.js auto-
    // injects /stamps/[tokenId]/opengraph-image (Satori-rendered card
    // that embeds the NFT art inside a Sendero brand frame). Slack +
    // WhatsApp + X all unfurl with the framed version, which beats the
    // bare Pinata gateway URL we used to advertise.
    openGraph: {
      title: stamp.name,
      description: stamp.caption,
      url,
      siteName: 'Sendero',
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: stamp.name,
      description: stamp.caption,
    },
    other: {
      'eth:nft:contract': stamp.contract,
      'eth:nft:token_id': stamp.tokenId,
      'eth:nft:chain': 'arc-testnet',
    },
    robots: { index: true, follow: true },
  };
}

export default async function StampPage({ params }: { params: Promise<PageParams> }) {
  const { tokenId } = await params;
  const stamp = await loadStampForOg(tokenId);
  if (!stamp) notFound();

  const arcscanUrl = `https://testnet-explorer.arc.com/token/${stamp.contract}?a=${stamp.tokenId}`;
  const ipfsHttp = stamp.ipfsUri.replace(/^ipfs:\/\//, 'https://ipfs.io/ipfs/');

  return (
    <main className="mx-auto flex min-h-screen max-w-[860px] flex-col gap-10 px-6 py-16 text-foreground">
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Sendero × Arc</p>
        <h1 className="font-display text-3xl">{stamp.name}</h1>
        {stamp.tenantDisplayName ? (
          <p className="text-sm text-muted-foreground">Issued by {stamp.tenantDisplayName}</p>
        ) : null}
      </header>

      <figure className="overflow-hidden rounded-2xl border border-border bg-muted/40">
        <div className="relative aspect-square w-full">
          <Image
            src={stamp.blobUrl}
            alt={stamp.name}
            fill
            sizes="(min-width: 768px) 720px, 100vw"
            priority
          />
        </div>
      </figure>

      <p className="text-lg leading-snug">{stamp.caption}</p>

      <dl className="grid grid-cols-1 gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
        {stamp.attributes.map(attr => (
          <div key={`${attr.trait_type}-${attr.value}`} className="flex flex-col gap-1">
            <dt className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
              {attr.trait_type}
            </dt>
            <dd className="text-foreground">{String(attr.value)}</dd>
          </div>
        ))}
        {stamp.mintedAt ? (
          <div className="flex flex-col gap-1">
            <dt className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Minted</dt>
            <dd className="text-foreground">{new Date(stamp.mintedAt).toLocaleString()}</dd>
          </div>
        ) : null}
        <div className="flex flex-col gap-1">
          <dt className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Token ID</dt>
          <dd className="font-mono text-foreground">{stamp.tokenId}</dd>
        </div>
      </dl>

      <nav className="flex flex-wrap gap-3 text-sm">
        <Link
          href={arcscanUrl}
          target="_blank"
          rel="noreferrer"
          className="rounded-md border border-border px-3 py-2 text-foreground hover:bg-muted"
        >
          View on Arcscan
        </Link>
        <Link
          href={ipfsHttp}
          target="_blank"
          rel="noreferrer"
          className="rounded-md border border-border px-3 py-2 text-foreground hover:bg-muted"
        >
          Raw IPFS metadata
        </Link>
        <Link
          href="/dashboard/stamps"
          className="rounded-md bg-foreground px-3 py-2 text-background hover:opacity-90"
        >
          See your collection
        </Link>
      </nav>

      <footer className="mt-auto pt-8 text-xs text-muted-foreground">
        Sendero — corporate travel on Arc.
      </footer>
    </main>
  );
}
