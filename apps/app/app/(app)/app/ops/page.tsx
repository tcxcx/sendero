import Link from 'next/link';

import { prisma } from '@sendero/database';
import { Badge } from '@sendero/ui/badge';
import { Button } from '@sendero/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@sendero/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@sendero/ui/table';
import { ArrowRight } from 'lucide-react';

import { PageHeader } from '@/components/app-shell/page-header';
import { TripStatusBadge } from '@/components/trips/trip-status-badge';
import { formatDateTime, formatDecimalUsd, formatMicroUsd, stringFromJson } from '@/lib/format';
import {
  type OpsChainStatus,
  opsChainSummary,
  opsGapPrompts,
  readinessLabel,
} from '@/lib/ops-chain';
import { requireCurrentTenant } from '@/lib/tenant-context';

export default async function OpsPage() {
  const { tenant } = await requireCurrentTenant();

  const [
    activeTrips,
    approvalTrips,
    serviceTrips,
    pendingBookings,
    openInvoices,
    whatsappChannels,
    slackChannels,
    emailChannels,
    recentTrips,
  ] = await Promise.all([
    prisma.trip.count({
      where: {
        tenantId: tenant.id,
        status: { in: ['draft', 'searching', 'awaiting_approval', 'booked', 'in_progress'] },
      },
    }),
    prisma.trip.count({ where: { tenantId: tenant.id, status: 'awaiting_approval' } }),
    prisma.trip.count({
      where: { tenantId: tenant.id, status: { in: ['booked', 'in_progress'] } },
    }),
    prisma.booking.count({
      where: { tenantId: tenant.id, status: { in: ['pending', 'confirmed'] } },
    }),
    prisma.invoice.aggregate({
      where: { tenantId: tenant.id, status: { in: ['issued', 'sent', 'viewed', 'overdue'] } },
      _count: true,
      _sum: { totalMicro: true },
    }),
    prisma.channelIdentity.count({ where: { tenantId: tenant.id, kind: 'whatsapp' } }),
    prisma.channelIdentity.count({ where: { tenantId: tenant.id, kind: 'slack' } }),
    prisma.channelIdentity.count({ where: { tenantId: tenant.id, kind: 'email' } }),
    prisma.trip.findMany({
      where: { tenantId: tenant.id },
      orderBy: { updatedAt: 'desc' },
      take: 6,
      select: {
        id: true,
        intent: true,
        metadata: true,
        status: true,
        totalUsdc: true,
        updatedAt: true,
      },
    }),
  ]);

  const connectedChannels = whatsappChannels + slackChannels + emailChannels;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Travel ops workspace"
        description={`${opsChainSummary.title}: quote, approve, book, change, refund, reconcile, and support trips from one operator surface.`}
        actions={
          <Button asChild>
            <Link href="/app/trips?sheet=new">
              Create prepaid trip
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </Button>
        }
      />

      <section className="grid gap-3 md:grid-cols-5">
        <OpsMetric label="Open work" value={activeTrips.toString()} detail="Trips needing state" />
        <OpsMetric label="Approvals" value={approvalTrips.toString()} detail="Policy review lane" />
        <OpsMetric
          label="Service desk"
          value={serviceTrips.toString()}
          detail="Booked or in trip"
        />
        <OpsMetric
          label="Booking holds"
          value={pendingBookings.toString()}
          detail="Pending vendor state"
        />
        <OpsMetric
          label="Receivables"
          value={formatMicroUsd(openInvoices._sum.totalMicro ?? 0n)}
          detail={`${openInvoices._count} open invoices`}
        />
      </section>

      <section className="rounded-lg border border-border bg-card p-5">
        <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <Badge variant="outline" className="rounded-sm">
              Legora-style wedge
            </Badge>
            <h2 className="mt-4 max-w-2xl text-2xl font-semibold tracking-normal">
              {opsChainSummary.subtitle}
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
              {opsChainSummary.thesis} The page below turns every known product gap into a
              skill-driven prompt and a visible implementation chain.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <ProofPoint label="Channel identities" value={connectedChannels.toString()} />
            <ProofPoint label="Workflow prompts" value={opsGapPrompts.length.toString()} />
            <ProofPoint label="Executable chains" value="3" />
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_0.78fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg tracking-normal">Operator queue</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Request</TableHead>
                  <TableHead>Lane</TableHead>
                  <TableHead>Money</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentTrips.map(trip => {
                  const lane = laneForTrip(trip.status);
                  const summary =
                    stringFromJson(trip.metadata, 'tripSummary', '') ||
                    stringFromJson(trip.intent, 'tripSummary', '') ||
                    trip.id.slice(0, 10);

                  return (
                    <TableRow key={trip.id}>
                      <TableCell>
                        <Link
                          href={`/app/trips/${trip.id}`}
                          className="font-medium hover:underline"
                        >
                          {summary}
                        </Link>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground">
                            {trip.id.slice(0, 12)}
                          </span>
                          <TripStatusBadge status={trip.status} />
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{lane.label}</div>
                        <div className="text-xs text-muted-foreground">{lane.nextAction}</div>
                      </TableCell>
                      <TableCell>{formatDecimalUsd(trip.totalUsdc)}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDateTime(trip.updatedAt)}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {recentTrips.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-muted-foreground">
                      No requests yet. Create a prepaid trip to seed the ops queue.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg tracking-normal">Channel fit</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <ChannelRow label="WhatsApp" value={whatsappChannels} status="ready" />
            <ChannelRow label="Slack" value={slackChannels} status="ready" />
            <ChannelRow label="Email" value={emailChannels} status="partial" />
            <ChannelRow label="CRM / GDS / NDC" value={0} status="gap" />
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        {opsGapPrompts.map(item => (
          <Card key={item.id} className="overflow-hidden">
            <CardHeader className="gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Badge variant="outline" className="rounded-sm">
                  {readinessLabel(item.readiness)} · {item.readiness}%
                </Badge>
                {item.workflowId ? (
                  <span className="font-mono text-xs text-muted-foreground">{item.workflowId}</span>
                ) : null}
              </div>
              <div>
                <CardTitle className="text-xl tracking-normal">{item.bucket}</CardTitle>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.gap}</p>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-wrap gap-2">
                {item.skills.map(skill => (
                  <Badge key={skill} variant="secondary" className="rounded-sm font-mono">
                    {skill}
                  </Badge>
                ))}
              </div>

              <div className="rounded-md border border-border bg-muted/25 p-3">
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Prompt
                </div>
                <pre className="whitespace-pre-wrap text-xs leading-5 text-foreground">
                  {item.prompt}
                </pre>
              </div>

              <div className="grid gap-2">
                {item.chain.map(step => (
                  <div
                    key={`${item.id}-${step.label}`}
                    className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-[8rem_1fr]"
                  >
                    <div>
                      <StatusPill status={step.status} />
                    </div>
                    <div>
                      <div className="text-sm font-medium">{step.label}</div>
                      <p className="mt-1 text-sm leading-5 text-muted-foreground">{step.detail}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground">
                {item.doneSignal}
              </div>
            </CardContent>
          </Card>
        ))}
      </section>
    </div>
  );
}

function OpsMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-3 text-2xl font-semibold tracking-normal">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
    </div>
  );
}

function ProofPoint({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-2 text-xl font-semibold">{value}</div>
    </div>
  );
}

function ChannelRow({
  label,
  value,
  status,
}: {
  label: string;
  value: number;
  status: OpsChainStatus;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{value} connected identities</div>
      </div>
      <StatusPill status={status} />
    </div>
  );
}

function StatusPill({ status }: { status: OpsChainStatus }) {
  const label = status === 'ready' ? 'ready' : status === 'partial' ? 'partial' : 'gap';
  return <span className={statusClass(status)}>{label}</span>;
}

function statusClass(status: OpsChainStatus): string {
  const base =
    'inline-flex rounded-sm border px-2 py-1 font-mono text-[11px] uppercase tracking-wide';
  if (status === 'ready') {
    return `${base} border-emerald-700/25 bg-emerald-50 text-emerald-900`;
  }
  if (status === 'partial') {
    return `${base} border-amber-700/25 bg-amber-50 text-amber-900`;
  }
  return `${base} border-border bg-muted text-muted-foreground`;
}

function laneForTrip(status: string): { label: string; nextAction: string } {
  switch (status) {
    case 'draft':
      return { label: 'Intake', nextAction: 'Complete trip intent and channel source' };
    case 'searching':
      return { label: 'Quote builder', nextAction: 'Compare inventory and draft options' };
    case 'awaiting_approval':
      return { label: 'Approval', nextAction: 'Resolve policy exception' };
    case 'booked':
      return { label: 'Service desk', nextAction: 'Monitor supplier state and traveler support' };
    case 'in_progress':
      return { label: 'In-trip support', nextAction: 'Handle changes, disruptions, and receipts' };
    case 'completed':
      return { label: 'Reconciliation', nextAction: 'Close invoice and audit trail' };
    case 'canceled':
      return { label: 'Refund desk', nextAction: 'Confirm refund or credit memo' };
    case 'failed':
      return { label: 'Exception', nextAction: 'Retry, escalate, or explain failure' };
    default:
      return { label: 'Ops queue', nextAction: 'Review next action' };
  }
}
