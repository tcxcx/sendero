import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Bot, Building2, Plus, Radio } from 'lucide-react';
import { prisma } from '@sendero/database';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { requirePlatformRole } from '@/lib/access';

export default async function OrganizationsPage() {
  const access = await requirePlatformRole(['superadmin']);
  if (!access.ok) redirect('/unauthorized');

  const tenants = await prisma.tenant.findMany({
    orderBy: { updatedAt: 'desc' },
    take: 24,
    select: {
      id: true,
      clerkOrgId: true,
      displayName: true,
      slug: true,
      billingTier: true,
      primaryChain: true,
      updatedAt: true,
      _count: {
        select: {
          memberships: true,
          whatsappFlowRegistrations: true,
        },
      },
      slackInstalls: {
        where: { revokedAt: null },
        take: 1,
        select: { id: true },
      },
      whatsappInstall: {
        select: { status: true },
      },
    },
  });

  const channelCount = tenants.reduce(
    (sum, tenant) =>
      sum +
      (tenant.slackInstalls.length > 0 ? 1 : 0) +
      (tenant.whatsappInstall?.status === 'active' ? 1 : 0),
    0
  );

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm text-[color:var(--color-muted-foreground)]">
            <Bot className="h-4 w-4" />
            Vertical agent organizations
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Organizations</h1>
          <p className="mt-2 max-w-2xl text-sm text-[color:var(--color-muted-foreground)]">
            Manage the Clerk-backed operating orgs that map to vertical agents and their tenants.
            Sendero is the travel vertical; future verticals reuse the same team, channel, and tool
            backbone with different adapters.
          </p>
        </div>
        <Button asChild>
          <Link href="/dashboard/orgs/new">
            <Plus className="h-4 w-4" />
            Create organization
          </Link>
        </Button>
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <Metric
          icon={<Building2 className="h-4 w-4" />}
          label="Tenant orgs"
          value={tenants.length.toLocaleString()}
        />
        <Metric
          icon={<Radio className="h-4 w-4" />}
          label="Connected channels"
          value={channelCount.toLocaleString()}
        />
        <Metric icon={<Bot className="h-4 w-4" />} label="Vertical template" value="Sendero" />
      </section>

      <div className="overflow-hidden rounded-lg border bg-[color:var(--color-card)]">
        <div className="border-b px-4 py-3">
          <h2 className="font-medium">Active organization map</h2>
          <p className="text-xs text-[color:var(--color-muted-foreground)]">
            Real tenant rows from Postgres. Clerk org ids stay visible for support and migration.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-sm">
            <thead className="bg-[color:var(--color-muted)] text-left text-xs text-[color:var(--color-muted-foreground)] uppercase">
              <tr>
                <th className="px-4 py-3 font-medium">Organization</th>
                <th className="px-4 py-3 font-medium">Clerk org</th>
                <th className="px-4 py-3 font-medium">Plan</th>
                <th className="px-4 py-3 font-medium">Channels</th>
                <th className="px-4 py-3 text-right font-medium">Members</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map(tenant => (
                <tr key={tenant.id} className="border-t">
                  <td className="px-4 py-3">
                    <div className="font-medium">{tenant.displayName}</div>
                    <div className="text-xs text-[color:var(--color-muted-foreground)]">
                      {tenant.slug} · {tenant.primaryChain}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{tenant.clerkOrgId}</td>
                  <td className="px-4 py-3 capitalize">{tenant.billingTier}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      <Pill active={tenant.slackInstalls.length > 0}>Slack</Pill>
                      <Pill active={tenant.whatsappInstall?.status === 'active'}>WhatsApp</Pill>
                      <Pill active={tenant._count.whatsappFlowRegistrations > 0}>Flows</Pill>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {tenant._count.memberships.toLocaleString()}
                  </td>
                </tr>
              ))}
              {tenants.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-10 text-center text-sm text-[color:var(--color-muted-foreground)]"
                  >
                    No tenant organizations found.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-[color:var(--color-muted-foreground)]">
          {icon}
          {label}
        </div>
        <p className="mt-2 text-2xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}

function Pill({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <span
      className={
        active
          ? 'rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-700'
          : 'rounded border px-2 py-1 text-xs text-[color:var(--color-muted-foreground)]'
      }
    >
      {children}
    </span>
  );
}
