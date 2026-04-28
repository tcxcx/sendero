/**
 * /dashboard/reputation — signed-in operator view of their own
 * tenant's reputation. Shows the org's ERC-8004 stats, recent
 * feedback, and a deep link to the public agent profile.
 *
 * Travelers see the same shape under /dashboard/reputation when
 * we add the user-side route — for v1 the dashboard is operator-only
 * since it's gated by Clerk org membership.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';

import { loadAgentProfile } from '@/lib/agent-profile';
import { requireCurrentTenant } from '@/lib/tenant-context';

export const dynamic = 'force-dynamic';

export default async function ReputationPage() {
  const { tenant } = await requireCurrentTenant();
  const profile = await loadAgentProfile({ kind: 'org', subjectId: tenant.id });

  if (!profile) {
    return (
      <main className="mx-auto flex w-full max-w-[860px] flex-col gap-6 px-6 pt-2 pb-8">
        <header className="flex flex-col gap-1">
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Sendero × Arc</p>
          <h1 className="font-display text-3xl">Your reputation</h1>
        </header>
        <div className="rounded-2xl border border-dashed border-border bg-muted/30 px-6 py-12 text-center">
          <p className="font-display text-xl">On-chain identity not minted yet.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Sendero provisions an ERC-8004 agent NFT atomically with your treasury wallet. If you've
            completed onboarding and don't see a profile within a few minutes, the cron sweeper at{' '}
            <code className="rounded bg-muted px-1">/api/cron/retry-identity-provision</code> is
            retrying — check back shortly.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-[860px] flex-col gap-8 px-6 pt-2 pb-8">
      <header className="flex flex-col gap-1">
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Sendero × Arc</p>
        <h1 className="font-display text-3xl">Your reputation</h1>
        <p className="text-sm text-muted-foreground">
          Aggregated from on-chain ERC-8004 ReputationRegistry events. Updates via Circle Event
          Monitor → webhook within seconds of each rating.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Stars" value={profile.stars ? profile.stars.toFixed(2) : '—'} />
        <Stat label="Ratings" value={String(profile.feedbackCount)} />
        <Stat label="Counterparties" value={String(profile.validatorCount)} />
        <Stat label="Validations" value={String(profile.validationCount)} />
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-xl">Recent feedback</h2>
          <Link
            href={`/agents/org/${tenant.id}`}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Public profile →
          </Link>
        </div>
        {profile.recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No on-chain feedback yet — accumulates after each settled trip closes via the
            rate_counterparty workflow.
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
                  <span>{new Date(r.createdAt).toLocaleString()}</span>
                  <span title={r.fromAddress}>{r.fromAddress.slice(0, 10)}…</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2 text-sm text-muted-foreground">
        <p>
          Status: <span className="font-mono text-foreground">{profile.status}</span>
        </p>
        {profile.agentId ? (
          <p>
            On-chain agent NFT:{' '}
            <span className="font-mono text-foreground">#{profile.agentId}</span>
          </p>
        ) : null}
        <p>
          Treasury holder:{' '}
          <span className="font-mono text-foreground">{profile.holderAddress}</span>
        </p>
        <p>
          <Link href="/dashboard/settings/reputation" className="underline">
            Configure your engagement policy →
          </Link>
        </p>
      </section>
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
