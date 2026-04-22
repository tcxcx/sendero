import { Card, CardContent, CardHeader, CardTitle } from '@sendero/ui/card';
import { Button } from '@sendero/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@sendero/ui/table';
import Link from 'next/link';
import { PageHeader } from '@/components/app-shell/page-header';
import { StatCard } from '@/components/dashboard/stat-card';
import { TripStatusBadge } from '@/components/trips/trip-status-badge';
import { formatDate, formatDecimalUsd, formatMicroUsd, stringFromJson } from '@/lib/format';
import { requireCurrentTenant } from '@/lib/tenant-context';
import { prisma } from '@sendero/database';

export default async function DashboardPage() {
  const { tenant } = await requireCurrentTenant();
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
      <PageHeader title="Home" description={`Buyer workspace for ${tenant.displayName}`} />

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-normal">Launch a traveler journey</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Start with a prepaid escrow link, then route the traveler through WhatsApp, Slack, web,
            or MCP without changing the booking engine.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          <JourneyShortcut
            href="/app/trips?sheet=new"
            label="Prepaid trip"
            description="Create a USDC budget and a traveler claim link."
          />
          <JourneyShortcut
            href="/onboarding/agency"
            label="WhatsApp agency"
            description="Connect a Business number for white-label travel."
          />
          <JourneyShortcut
            href="/onboarding/corporate"
            label="Slack workplace"
            description="Install approvals and employee travel DMs."
          />
          <JourneyShortcut
            href="/llms.txt"
            label="MCP agents"
            description="Expose the same journey to other LLMs."
          />
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard title="Active trips" value={String(activeTrips)} href="/app/trips" />
        <StatCard
          title="Unpaid invoices"
          value={formatMicroUsd(unpaidInvoices._sum.totalMicro ?? 0n)}
          description={`${unpaidInvoices._count} open`}
          href="/app/billing/invoices?status=issued"
        />
        <StatCard
          title="Month-to-date spend"
          value={formatMicroUsd(mtdSpend._sum.priceMicroUsdc ?? 0n)}
          href="/app/spend"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent trips</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Trip</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Budget</TableHead>
                <TableHead>Created</TableHead>
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
                    No trips yet.
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
}: {
  href: string;
  label: string;
  description: string;
}) {
  return (
    <div className="flex min-h-40 flex-col justify-between rounded-md border border-border bg-background p-4">
      <div>
        <h2 className="text-base font-medium">{label}</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      <Button asChild variant="outline" size="sm" className="mt-4 justify-start">
        <Link href={href}>Open</Link>
      </Button>
    </div>
  );
}
