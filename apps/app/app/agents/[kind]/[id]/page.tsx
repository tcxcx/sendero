/**
 * Public ERC-8004 agent profile — for both orgs (travel agencies) and
 * users (travelers). Lives outside `(app)` so Slackbot / WhatsApp / X
 * can fetch the OG payload without a Clerk session.
 *
 * URL slug uses the Sendero id (Tenant.id / User.id), not the on-chain
 * agentId, so the URL is stable across any future re-mint.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { loadAgentProfile } from '@/lib/agent-profile';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface PageParams {
  kind: string;
  id: string;
}

const KIND_DESCRIPTION: Record<string, string> = {
  org: 'Travel agency on the Sendero protocol — settles bookings on Arc-Testnet.',
  user: 'Sendero traveler with an on-chain identity on Arc-Testnet.',
};

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { kind, id } = await params;
  if (kind !== 'org' && kind !== 'user') return { title: 'Not found · Sendero' };
  const profile = await loadAgentProfile({ kind, subjectId: id });
  if (!profile) return { title: 'Agent not found · Sendero' };

  const url = `https://app.sendero.travel/agents/${kind}/${id}`;
  const title = profile.stars
    ? `${profile.displayName} · ${profile.stars.toFixed(1)}★ on Sendero`
    : `${profile.displayName} · Sendero`;
  const description =
    profile.feedbackCount > 0
      ? `${profile.stars?.toFixed(2) ?? '—'}★ across ${profile.feedbackCount} ratings from ${profile.validatorCount} distinct counterparties on Arc-Testnet.`
      : KIND_DESCRIPTION[kind];

  return {
    title,
    description,
    openGraph: { title, description, url, siteName: 'Sendero', type: 'profile' },
    twitter: { card: 'summary', title, description },
    other: profile.agentId
      ? {
          'eth:nft:contract': profile.contract,
          'eth:nft:token_id': profile.agentId,
          'eth:nft:chain': 'arc-testnet',
        }
      : {},
    robots: { index: true, follow: true },
  };
}

export default async function AgentProfilePage({ params }: { params: Promise<PageParams> }) {
  const { kind, id } = await params;
  if (kind !== 'org' && kind !== 'user') notFound();
  const profile = await loadAgentProfile({ kind, subjectId: id });
  if (!profile) notFound();

  const arcscanUrl = profile.agentId
    ? `https://testnet-explorer.arc.com/token/${profile.contract}?a=${profile.agentId}`
    : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-[860px] flex-col gap-10 px-6 py-16 text-foreground">
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
          Sendero · {kind === 'org' ? 'Agency' : 'Traveler'}
        </p>
        <h1 className="font-display text-3xl">{profile.displayName}</h1>
        <p className="text-sm text-muted-foreground">{KIND_DESCRIPTION[kind]}</p>
      </header>

      <section className="grid grid-cols-2 gap-6 sm:grid-cols-4">
        <Stat label="Stars" value={profile.stars ? profile.stars.toFixed(2) : '—'} />
        <Stat label="Ratings" value={String(profile.feedbackCount)} />
        <Stat label="Counterparties" value={String(profile.validatorCount)} />
        <Stat label="Validations" value={String(profile.validationCount)} />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-xl">Recent feedback</h2>
        {profile.recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No on-chain feedback yet. Reputation accumulates after the first settled trip.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {profile.recent.map(r => (
              <li
                key={r.txHash}
                className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-center gap-3">
                  <span className="text-lg">{'★'.repeat(r.stars)}</span>
                  <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                    {r.tag ?? 'rating'}
                  </span>
                </div>
                <div className="flex items-center gap-3 font-mono text-xs text-muted-foreground">
                  <span title={r.fromAddress}>{r.fromAddress.slice(0, 10)}…</span>
                  <Link
                    href={`https://testnet-explorer.arc.com/tx/${r.txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    tx
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2 text-sm text-muted-foreground">
        <p>
          On-chain agent NFT:{' '}
          {profile.agentId ? (
            <span className="font-mono text-foreground">#{profile.agentId}</span>
          ) : (
            <span className="text-yellow-600">pending mint</span>
          )}
        </p>
        <p>
          Holder address: <span className="font-mono text-foreground">{profile.holderAddress}</span>
        </p>
        {profile.mintedAt ? <p>Minted: {new Date(profile.mintedAt).toLocaleString()}</p> : null}
      </section>

      <nav className="flex flex-wrap gap-3 text-sm">
        {arcscanUrl ? (
          <Link
            href={arcscanUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-border px-3 py-2 text-foreground hover:bg-muted"
          >
            View on Arcscan
          </Link>
        ) : null}
        <Link
          href={`/agents/${kind}/${id}/metadata.json`}
          target="_blank"
          rel="noreferrer"
          className="rounded-md border border-border px-3 py-2 text-foreground hover:bg-muted"
        >
          ERC-8004 metadata JSON
        </Link>
      </nav>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-card px-4 py-3">
      <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="font-display text-2xl">{value}</p>
    </div>
  );
}
