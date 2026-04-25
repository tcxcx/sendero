/**
 * /dashboard/settings/reputation — operator policy editor.
 * Server-renders the current ReputationPolicy, hands off to a small
 * client form for the actual mutation. The form posts to the route
 * built in commit 5 (/api/tenant/reputation-policy).
 */

import { prisma } from '@sendero/database';

import { requireCurrentTenant } from '@/lib/tenant-context';

import { ReputationPolicyEditor } from './editor-client';

export const dynamic = 'force-dynamic';

export default async function ReputationSettingsPage() {
  const { tenant } = await requireCurrentTenant();
  const policy = await prisma.reputationPolicy.findUnique({
    where: { tenantId: tenant.id },
  });

  return (
    <main className="mx-auto flex w-full max-w-[720px] flex-col gap-6 px-6 py-10">
      <header className="flex flex-col gap-1">
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Sendero × Arc</p>
        <h1 className="font-display text-3xl">Engagement policy</h1>
        <p className="text-sm text-muted-foreground">
          Rules that gate which counterparties your agency engages with. Reads cached ERC-8004
          reputation for sub-50ms checks at every dispatch. Defaults to{' '}
          <code className="rounded bg-muted px-1">warn</code> so violations surface in the dashboard
          before you flip to <code className="rounded bg-muted px-1">block</code>.
        </p>
      </header>

      <ReputationPolicyEditor
        initial={{
          minStars: policy?.minStars ?? null,
          minTripCount: policy?.minTripCount ?? null,
          maxDisputeRatio: policy?.maxDisputeRatio ?? null,
          requireKyc: policy?.requireKyc ?? false,
          requireKyb: policy?.requireKyb ?? false,
          enforcement: (policy?.enforcement ?? 'warn') as 'block' | 'warn' | 'allow',
        }}
      />
    </main>
  );
}
