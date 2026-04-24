import Link from 'next/link';

import { PLANS, type PlanTier } from '@sendero/billing/plans';
import { prisma } from '@sendero/database';
import { Button } from '@sendero/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@sendero/ui/table';
import { ArrowRight } from 'lucide-react';

import { PageHeader } from '@/components/app-shell/page-header';
import { StatCard } from '@/components/dashboard/stat-card';
import { TripStatusBadge } from '@/components/trips/trip-status-badge';
import { currentOrgPlanTier } from '@/lib/billing-plan';
import { getAppCopy } from '@/lib/app-copy';
import { formatDate, formatDecimalUsd, formatMicroUsd, stringFromJson } from '@/lib/format';
import { getRequestLocale } from '@/lib/request-locale';
import { requireCurrentTenant } from '@/lib/tenant-context';

export default async function DashboardPage() {
  const { tenant } = await requireCurrentTenant();
  const locale = await getRequestLocale();
  const copy = getAppCopy(locale).dashboard;
  const planTier = await currentOrgPlanTier();
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const [activeTrips, recentTrips, unpaidInvoices, mtdSpend] = await Promise.all([
    prisma.trip.count({
      where: {
        tenantId: tenant.id,
        status: { in: ['draft', 'searching', 'awaiting_approval', 'booked', 'in_progress'] },
      },
    }),
    prisma.trip.findMany({
      where: { tenantId: tenant.id },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        status: true,
        totalUsdc: true,
        metadata: true,
        intent: true,
        createdAt: true,
      },
    }),
    prisma.invoice.aggregate({
      where: { tenantId: tenant.id, status: { in: ['issued', 'sent', 'viewed', 'overdue'] } },
      _sum: { totalMicro: true },
      _count: true,
    }),
    prisma.meterEvent.aggregate({
      where: { tenantId: tenant.id, status: 'paid', at: { gte: monthStart } },
      _sum: { priceMicroUsdc: true },
    }),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={copy.pageTitle}
        description={copy.pageDescription(tenant.displayName)}
        actions={
          <Button asChild>
            <Link href="/dashboard/trips?sheet=new">
              Create prepaid trip
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </Button>
        }
      />

      <section className="grid gap-3 rounded-[var(--radius-lg)] bg-white px-5 py-4 shadow-[var(--shadow-md)] md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-6">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-normal text-foreground">
            {copy.agentConsole.title}
          </h2>
          <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">
            {copy.agentConsole.description}
          </p>
        </div>
        <Button asChild size="lg" className="w-full justify-center md:w-auto">
          <Link href="/dashboard/console">{copy.agentConsole.cta}</Link>
        </Button>
      </section>

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-normal">{copy.journeyTitle}</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{copy.journeyDescription}</p>
        </div>
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(13rem,1fr))]">
          {copy.shortcuts.map(shortcut => (
            <JourneyShortcut
              key={shortcut.href}
              href={shortcut.href}
              label={shortcut.label}
              description={shortcut.description}
              openLabel={copy.shortcutOpen}
            />
          ))}
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          title={copy.stats.activeTrips}
          value={String(activeTrips)}
          href="/dashboard/trips"
        />
        <StatCard
          title={copy.stats.unpaidInvoices}
          value={formatMicroUsd(unpaidInvoices._sum.totalMicro ?? 0n)}
          description={copy.stats.openInvoices(unpaidInvoices._count)}
          href="/dashboard/billing/invoices?status=issued"
        />
        <StatCard
          title={copy.stats.monthToDateSpend}
          value={formatMicroUsd(mtdSpend._sum.priceMicroUsdc ?? 0n)}
          href="/dashboard/spend"
        />
      </div>

      <PlanTeaser tier={planTier} />

      <section className="flex flex-col gap-3 rounded-[var(--radius-lg)] bg-white px-5 py-4 shadow-[var(--shadow-md)]">
        <h3 className="text-[15px] font-semibold tracking-normal text-foreground">
          {copy.recentTrips.title}
        </h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{copy.recentTrips.trip}</TableHead>
              <TableHead>{copy.recentTrips.status}</TableHead>
              <TableHead>{copy.recentTrips.budget}</TableHead>
              <TableHead>{copy.recentTrips.created}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recentTrips.map(trip => (
              <TableRow key={trip.id}>
                <TableCell>
                  <Link
                    href={`/dashboard/trips/${trip.id}`}
                    className="font-medium hover:underline"
                  >
                    {stringFromJson(trip.metadata, 'tripSummary', trip.id.slice(0, 10))}
                  </Link>
                </TableCell>
                <TableCell>
                  <TripStatusBadge status={trip.status} />
                </TableCell>
                <TableCell style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {formatDecimalUsd(trip.totalUsdc)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDate(trip.createdAt)}
                </TableCell>
              </TableRow>
            ))}
            {recentTrips.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-muted-foreground">
                  {copy.recentTrips.empty}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}

function JourneyShortcut({
  href,
  label,
  description,
  openLabel,
}: {
  href: string;
  label: string;
  description: string;
  openLabel: string;
}) {
  return (
    <div className="flex min-h-40 flex-col justify-between rounded-[var(--radius-lg)] bg-white p-5 shadow-[var(--shadow-sm)] transition-shadow duration-200 hover:shadow-[var(--shadow-md)]">
      <div>
        <h2 className="text-base font-medium tracking-normal text-foreground">{label}</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      <Button
        asChild
        size="sm"
        className="mt-4 justify-start !rounded-md bg-[color:var(--ink)] text-white hover:bg-[color:color-mix(in_oklab,var(--ink)_92%,black)]"
      >
        <Link href={href}>{openLabel}</Link>
      </Button>
    </div>
  );
}

function PlanTeaser({ tier }: { tier: PlanTier }) {
  const plan = PLANS[tier];
  const order: PlanTier[] = ['free', 'basic', 'pro', 'enterprise'];
  const nextTier =
    tier === 'free' ? 'basic' : tier === 'basic' ? 'pro' : tier === 'pro' ? 'enterprise' : null;
  const nextPlan = nextTier ? PLANS[nextTier] : null;

  return (
    <section className="flex flex-col gap-4 rounded-[var(--radius-lg)] bg-white p-6 shadow-[var(--shadow-md)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            Current plan
          </div>
          <h3 className="mt-1 text-lg font-semibold tracking-normal capitalize text-foreground">
            {plan.tier}
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {plan.workspaceLimit === null
                ? 'unlimited workspaces'
                : `${plan.workspaceLimit} workspace${plan.workspaceLimit === 1 ? '' : 's'}`}
              {plan.nanopaymentDiscountBps > 0
                ? ` · ${plan.nanopaymentDiscountBps / 100}% off nanopayments`
                : ''}
            </span>
          </h3>
        </div>
        <Button asChild variant="outline" size="sm" className="!rounded-md">
          <Link href="/dashboard/billing/plans">Manage plan</Link>
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        {order.map(t => {
          const p = PLANS[t];
          const active = t === tier;
          return (
            <Link
              key={t}
              href="/dashboard/billing/plans"
              className={
                'flex flex-col gap-1 rounded-[var(--radius-md)] border p-4 transition-colors ' +
                (active
                  ? 'border-[color:var(--ink)] bg-[color:color-mix(in_oklab,var(--ink)_6%,white)]'
                  : 'border-[color:var(--border)] bg-white hover:border-[color:var(--ink)]')
              }
            >
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {p.tier}
              </div>
              <div className="text-lg font-semibold text-foreground">
                {p.monthlyUsd === null
                  ? 'Custom'
                  : p.monthlyUsd === 0
                    ? 'Free'
                    : `$${p.monthlyUsd}/mo`}
              </div>
              <div className="text-xs text-muted-foreground">
                {p.workspaceLimit === null
                  ? 'Unlimited workspaces'
                  : `${p.workspaceLimit} workspace${p.workspaceLimit === 1 ? '' : 's'}`}
              </div>
              {active ? (
                <div className="mt-auto pt-1 text-[11px] font-mono uppercase tracking-[0.12em] text-[color:var(--ink)]">
                  Current
                </div>
              ) : nextPlan && t === nextPlan.tier ? (
                <div className="mt-auto pt-1 text-[11px] font-mono uppercase tracking-[0.12em] text-[color:var(--ink)]">
                  Upgrade →
                </div>
              ) : null}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
