import Link from 'next/link';

import { prisma } from '@sendero/database';
import { Button } from '@sendero/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@sendero/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@sendero/ui/table';

import { PageHeader } from '@/components/app-shell/page-header';
import { StatCard } from '@/components/dashboard/stat-card';
import { TripStatusBadge } from '@/components/trips/trip-status-badge';
import { getAppCopy } from '@/lib/app-copy';
import { formatDate, formatDecimalUsd, formatMicroUsd, stringFromJson } from '@/lib/format';
import { getRequestLocale } from '@/lib/request-locale';
import { requireCurrentTenant } from '@/lib/tenant-context';

export default async function DashboardPage() {
  const { tenant } = await requireCurrentTenant();
  const locale = await getRequestLocale();
  const copy = getAppCopy(locale).dashboard;
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
    <div className="flex flex-col gap-6">
      <PageHeader title={copy.pageTitle} description={copy.pageDescription(tenant.displayName)} />

      <section className="grid gap-4 rounded-md border border-border bg-muted/30 p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-6">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{copy.agentConsole.title}</h2>
          <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">
            {copy.agentConsole.description}
          </p>
        </div>
        <Button asChild size="lg" className="w-full justify-center md:w-auto">
          <Link href="/app/console">{copy.agentConsole.cta}</Link>
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
        <StatCard title={copy.stats.activeTrips} value={String(activeTrips)} href="/app/trips" />
        <StatCard
          title={copy.stats.unpaidInvoices}
          value={formatMicroUsd(unpaidInvoices._sum.totalMicro ?? 0n)}
          description={copy.stats.openInvoices(unpaidInvoices._count)}
          href="/app/billing/invoices?status=issued"
        />
        <StatCard
          title={copy.stats.monthToDateSpend}
          value={formatMicroUsd(mtdSpend._sum.priceMicroUsdc ?? 0n)}
          href="/app/spend"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{copy.recentTrips.title}</CardTitle>
        </CardHeader>
        <CardContent>
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
                    <Link href={`/app/trips/${trip.id}`} className="font-medium hover:underline">
                      {stringFromJson(trip.metadata, 'tripSummary', trip.id.slice(0, 10))}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <TripStatusBadge status={trip.status} />
                  </TableCell>
                  <TableCell>{formatDecimalUsd(trip.totalUsdc)}</TableCell>
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
        </CardContent>
      </Card>
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
    <div className="flex min-h-40 flex-col justify-between rounded-md border border-border bg-background p-4">
      <div>
        <h2 className="text-base font-medium">{label}</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      <Button asChild variant="outline" size="sm" className="mt-4 justify-start">
        <Link href={href}>{openLabel}</Link>
      </Button>
    </div>
  );
}
