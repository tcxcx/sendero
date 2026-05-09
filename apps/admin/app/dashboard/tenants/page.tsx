import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ExternalLink,
  MessageSquareWarning,
  Plus,
  Radio,
  Search,
  SlidersHorizontal,
  Wallet,
} from 'lucide-react';
import { prisma } from '@sendero/database';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { requirePlatformRole } from '@/lib/access';
import { cn } from '@/lib/utils';

import { briefSupportAgentAction } from './actions';

const MICRO_USDC = 1_000_000n;

type CountRow = {
  tenantId: string | null;
  _count: { _all: number };
};

type SlackRouting = {
  defaultChannel?: unknown;
  routes?: unknown;
};

type PageProps = {
  searchParams?: Promise<{
    q?: string;
  }>;
};

function money(value: bigint | number | null | undefined) {
  const micro = typeof value === 'bigint' ? value : BigInt(value ?? 0);
  const dollars = micro / MICRO_USDC;
  const cents = (micro % MICRO_USDC) / 10_000n;
  return `$${dollars.toLocaleString()}.${cents.toString().padStart(2, '0')}`;
}

function countMap(rows: CountRow[]) {
  return new Map(rows.flatMap(row => (row.tenantId ? [[row.tenantId, row._count._all]] : [])));
}

function routingChannel(routing: unknown) {
  if (!routing || typeof routing !== 'object') return null;
  const value = (routing as SlackRouting).defaultChannel;
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function slackHref(teamId: string, channel: string | null) {
  if (!channel) return `https://app.slack.com/client/${teamId}`;
  const clean = channel.replace(/^#/, '');
  return `https://app.slack.com/client/${teamId}/${clean}`;
}

function statusTone(value: 'ready' | 'attention' | 'blocked') {
  if (value === 'ready') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700';
  if (value === 'attention') return 'border-amber-500/30 bg-amber-500/10 text-amber-700';
  return 'border-red-500/30 bg-red-500/10 text-red-700';
}

function HealthPill({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: 'ready' | 'attention' | 'blocked';
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded border px-2 py-1 text-xs font-medium',
        statusTone(tone)
      )}
    >
      {children}
    </span>
  );
}

export default async function TenantCommandCenterPage(props: PageProps) {
  const access = await requirePlatformRole(['superadmin', 'sales', 'support']);
  if (!access.ok) redirect('/unauthorized');
  const searchParams = await props.searchParams;
  const query = (searchParams?.q ?? '').trim();

  const [tenants, handoffRows, supportRows, settlementRows, invoiceRows] = await Promise.all([
    prisma.tenant.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 24,
      select: {
        id: true,
        slug: true,
        displayName: true,
        billingTier: true,
        primaryChain: true,
        arcAddress: true,
        billingContactEmail: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            trips: true,
            bookings: true,
            circleWallets: true,
            slackInstalls: true,
            slackUserBindings: true,
            whatsappFlowRegistrations: true,
          },
        },
        slackInstalls: {
          orderBy: { updatedAt: 'desc' },
          take: 1,
          select: {
            teamId: true,
            teamName: true,
            revokedAt: true,
            routing: true,
            updatedAt: true,
          },
        },
        whatsappInstall: {
          select: {
            status: true,
            businessDisplayName: true,
            displayPhoneNumber: true,
            phoneNumberId: true,
            lastHealthyAt: true,
            lastErrorMessage: true,
          },
        },
        whatsappOutbound: {
          orderBy: { sentAt: 'desc' },
          take: 1,
          select: {
            deliveryStatus: true,
            sentAt: true,
            failedAt: true,
          },
        },
        circleWallets: {
          orderBy: { updatedAt: 'desc' },
          take: 3,
          select: {
            address: true,
            kind: true,
            chain: true,
            usdcBalanceMicro: true,
            balanceUpdatedAt: true,
          },
        },
        gatewayConfig: {
          select: {
            evmDepositorAddress: true,
            solanaDepositorAddress: true,
            enabledDomains: true,
          },
        },
        settlements: {
          orderBy: { createdAt: 'desc' },
          take: 8,
          select: {
            status: true,
            grossMicroUsdc: true,
            senderoTakeMicroUsdc: true,
          },
        },
        supportTurns: {
          orderBy: { createdAt: 'desc' },
          take: 2,
          select: {
            outcome: true,
            turnSummary: true,
            createdAt: true,
          },
        },
        channelHandoffs: {
          where: { status: 'pending' },
          orderBy: { createdAt: 'desc' },
          take: 2,
          select: {
            question: true,
            channel: true,
            createdAt: true,
          },
        },
      },
    }),
    prisma.channelHandoff.groupBy({
      by: ['tenantId'],
      where: { status: 'pending' },
      _count: { _all: true },
    }),
    prisma.supportTurn.groupBy({
      by: ['tenantId'],
      where: { outcome: { in: ['escalated', 'unresolved'] } },
      _count: { _all: true },
    }),
    prisma.settlement.groupBy({
      by: ['tenantId'],
      where: { status: { in: ['pending', 'failed', 'reverted'] } },
      _count: { _all: true },
    }),
    prisma.invoice.groupBy({
      by: ['tenantId'],
      where: { status: { in: ['issued', 'sent', 'overdue'] } },
      _count: { _all: true },
    }),
  ]);

  const handoffCounts = countMap(handoffRows);
  const supportCounts = countMap(supportRows);
  const settlementCounts = countMap(settlementRows);
  const invoiceCounts = countMap(invoiceRows);

  const totals = tenants.reduce(
    (acc, tenant) => {
      acc.handoffs += handoffCounts.get(tenant.id) ?? 0;
      acc.support += supportCounts.get(tenant.id) ?? 0;
      acc.settlement += settlementCounts.get(tenant.id) ?? 0;
      acc.invoice += invoiceCounts.get(tenant.id) ?? 0;
      acc.slack += tenant.slackInstalls.some(install => !install.revokedAt) ? 1 : 0;
      acc.whatsapp += tenant.whatsappInstall?.status === 'active' ? 1 : 0;
      return acc;
    },
    { handoffs: 0, support: 0, settlement: 0, invoice: 0, slack: 0, whatsapp: 0 }
  );

  const tenantRows = tenants.map(tenant => {
    const activeSlack = tenant.slackInstalls.find(install => !install.revokedAt) ?? null;
    const whatsapp = tenant.whatsappInstall;
    const activeWhatsApp = whatsapp?.status === 'active';
    const latestWhatsAppOutbound = tenant.whatsappOutbound[0] ?? null;
    const channel = routingChannel(activeSlack?.routing);
    const openHandoffs = handoffCounts.get(tenant.id) ?? 0;
    const supportIssues = supportCounts.get(tenant.id) ?? 0;
    const paymentIssues =
      (settlementCounts.get(tenant.id) ?? 0) + (invoiceCounts.get(tenant.id) ?? 0);
    const treasuryAddress =
      tenant.arcAddress ??
      tenant.circleWallets.find(wallet => wallet.kind === 'treasury')?.address ??
      null;
    const readiness: 'ready' | 'attention' | 'blocked' =
      (!activeSlack && !activeWhatsApp) || !treasuryAddress
        ? 'blocked'
        : openHandoffs || paymentIssues || whatsapp?.status === 'error'
          ? 'attention'
          : 'ready';
    const supportHref = activeSlack ? slackHref(activeSlack.teamId, channel) : null;
    const recentSettlement = tenant.settlements[0];
    return {
      tenant,
      activeSlack,
      activeWhatsApp,
      latestWhatsAppOutbound,
      channel,
      whatsapp,
      openHandoffs,
      supportIssues,
      paymentIssues,
      treasuryAddress,
      readiness,
      supportHref,
      recentSettlement,
    };
  });

  const normalizedQuery = query.toLowerCase();
  const filteredRows = normalizedQuery
    ? tenantRows.filter(({ tenant, activeSlack, whatsapp }) =>
        [
          tenant.displayName,
          tenant.slug,
          tenant.billingContactEmail,
          tenant.billingTier,
          tenant.primaryChain,
          activeSlack?.teamName,
          whatsapp?.businessDisplayName,
          whatsapp?.displayPhoneNumber,
          whatsapp?.phoneNumberId,
        ]
          .filter(Boolean)
          .some(value => String(value).toLowerCase().includes(normalizedQuery))
      )
    : tenantRows;

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm text-[color:var(--color-muted-foreground)]">
            <Bot className="h-4 w-4" />
            Customer support agent
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Tenant Command Center</h1>
          <p className="mt-2 max-w-2xl text-sm text-[color:var(--color-muted-foreground)]">
            Multitenant operating board for Slack and WhatsApp support, treasury readiness, payment
            risk, and customer handoffs.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/dashboard/health">
              <Radio className="h-4 w-4" />
              Ops health
            </Link>
          </Button>
          <Button asChild>
            <Link href="/dashboard/orgs/new">
              <Plus className="h-4 w-4" />
              Add org
            </Link>
          </Button>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-4">
        <Metric label="Tenants watched" value={tenants.length.toString()} />
        <Metric
          label="Channels live"
          value={`${totals.slack + totals.whatsapp}/${tenants.length * 2}`}
        />
        <Metric label="Open handoffs" value={totals.handoffs.toString()} />
        <Metric label="Payment attention" value={(totals.settlement + totals.invoice).toString()} />
      </section>

      <section className="space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <form className="flex flex-1 flex-col gap-2 sm:flex-row" action="/dashboard/tenants">
            <label className="relative max-w-sm flex-1">
              <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-3 h-4 w-4 text-[color:var(--color-muted-foreground)]" />
              <input
                name="q"
                defaultValue={query}
                placeholder="Search tenants..."
                className="h-10 w-full rounded-md border bg-[color:var(--color-background)] pr-3 pl-9 text-sm outline-none transition focus:border-[color:var(--color-ring)] focus:ring-2 focus:ring-[color:var(--color-ring)]/20"
              />
            </label>
            <Button type="submit" variant="outline">
              <MessageSquareWarning className="h-4 w-4" />
              support
            </Button>
          </form>
          <Button variant="outline">
            <SlidersHorizontal className="h-4 w-4" />
            View
          </Button>
        </div>

        <div className="overflow-hidden rounded-lg border bg-[color:var(--color-card)]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] table-fixed text-sm">
              <colgroup>
                <col className="w-[26%]" />
                <col className="w-[12%]" />
                <col className="w-[16%]" />
                <col className="w-[19%]" />
                <col className="w-[10%]" />
                <col className="w-[17%]" />
              </colgroup>
              <thead className="bg-[color:var(--color-muted)] text-left text-xs text-[color:var(--color-muted-foreground)] uppercase">
                <tr>
                  <th className="px-4 py-3 font-medium">Tenant</th>
                  <th className="px-4 py-3 font-medium">Support</th>
                  <th className="px-4 py-3 font-medium">Channels</th>
                  <th className="px-4 py-3 font-medium">Treasury</th>
                  <th className="px-4 py-3 font-medium">Revenue</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map(
                  ({
                    tenant,
                    activeSlack,
                    activeWhatsApp,
                    latestWhatsAppOutbound,
                    channel,
                    whatsapp,
                    openHandoffs,
                    supportIssues,
                    paymentIssues,
                    treasuryAddress,
                    readiness,
                    supportHref,
                    recentSettlement,
                  }) => (
                    <tr key={tenant.id} id={tenant.id} className="border-t">
                      <td className="px-4 py-3 align-middle">
                        <div className="flex min-w-0 flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate font-medium">{tenant.displayName}</span>
                            <HealthPill tone={readiness}>
                              {readiness === 'ready'
                                ? 'ready'
                                : readiness === 'attention'
                                  ? 'watch'
                                  : 'setup'}
                            </HealthPill>
                          </div>
                          <span className="truncate text-xs text-[color:var(--color-muted-foreground)]">
                            {tenant.slug} · {tenant.billingTier} ·{' '}
                            {tenant.billingContactEmail ?? 'no billing contact'}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 align-middle">
                        <div className="flex min-w-0 items-center gap-2 font-medium">
                          <MessageSquareWarning className="h-4 w-4 text-[color:var(--color-primary)]" />
                          {openHandoffs} handoff{openHandoffs === 1 ? '' : 's'}
                        </div>
                        <p className="mt-1 text-xs text-[color:var(--color-muted-foreground)]">
                          {supportIssues} unresolved turn{supportIssues === 1 ? '' : 's'}
                        </p>
                      </td>
                      <td className="px-4 py-3 align-middle">
                        <div className="space-y-2">
                          <div className="flex min-w-0 items-center gap-2 font-medium">
                            {activeSlack ? (
                              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                            ) : (
                              <AlertTriangle className="h-4 w-4 text-amber-600" />
                            )}
                            <span className="truncate">{activeSlack?.teamName ?? 'Slack'}</span>
                          </div>
                          <p className="truncate text-xs text-[color:var(--color-muted-foreground)]">
                            {channel ?? 'default route not set'}
                          </p>
                          <div className="flex min-w-0 items-center gap-2 font-medium">
                            {activeWhatsApp ? (
                              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                            ) : (
                              <AlertTriangle className="h-4 w-4 text-amber-600" />
                            )}
                            <span className="truncate">
                              {whatsapp?.businessDisplayName ?? 'WhatsApp'}
                            </span>
                          </div>
                          <p className="truncate text-xs text-[color:var(--color-muted-foreground)]">
                            {whatsapp?.displayPhoneNumber ?? whatsapp?.status ?? 'not connected'}{' '}
                            {latestWhatsAppOutbound
                              ? `· last ${latestWhatsAppOutbound.deliveryStatus}`
                              : ''}
                          </p>
                        </div>
                      </td>
                      <td className="px-4 py-3 align-middle">
                        <div className="flex min-w-0 items-center gap-2 font-medium">
                          <Wallet className="h-4 w-4 text-[color:var(--color-primary)]" />
                          <span className="truncate">
                            {treasuryAddress ? 'Ready' : 'Not configured'}
                          </span>
                        </div>
                        <p className="mt-1 max-w-48 truncate font-mono text-xs text-[color:var(--color-muted-foreground)]">
                          {treasuryAddress ?? tenant.primaryChain}
                        </p>
                      </td>
                      <td className="px-4 py-3 align-middle">
                        <div className="font-medium">
                          {recentSettlement
                            ? money(recentSettlement.senderoTakeMicroUsdc)
                            : '$0.00'}
                        </div>
                        <p className="mt-1 text-xs text-[color:var(--color-muted-foreground)]">
                          {paymentIssues} payment item{paymentIssues === 1 ? '' : 's'}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-right align-middle">
                        <div className="flex justify-end gap-1.5">
                          <form action={briefSupportAgentAction}>
                            <input type="hidden" name="tenantId" value={tenant.id} />
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!activeSlack || !channel}
                              className="px-2.5"
                            >
                              Brief support
                            </Button>
                          </form>
                          {supportHref ? (
                            <Button size="sm" variant="ghost" className="px-2.5" asChild>
                              <a href={supportHref} target="_blank" rel="noreferrer">
                                Slack
                                <ExternalLink className="h-3.5 w-3.5" />
                              </a>
                            </Button>
                          ) : null}
                          <Button size="sm" variant="ghost" className="px-2.5" asChild>
                            <Link href={`/dashboard/tenants#${tenant.id}`}>Inspect</Link>
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                )}
                {filteredRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-10 text-center text-sm text-[color:var(--color-muted-foreground)]"
                    >
                      No tenants match this view.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-3 border-t px-4 py-3 text-sm text-[color:var(--color-muted-foreground)] sm:flex-row sm:items-center sm:justify-between">
            <span>{filteredRows.length} row(s) total.</span>
            <div className="flex items-center gap-3">
              <span>Rows per page</span>
              <Button size="sm" variant="outline" disabled>
                10
              </Button>
              <span>Page 1 of 1</span>
              <Button size="sm" variant="outline" disabled>
                ‹
              </Button>
              <Button size="sm" variant="outline" disabled>
                ›
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-[color:var(--color-muted-foreground)]">{label}</p>
        <p className="mt-2 text-2xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}
