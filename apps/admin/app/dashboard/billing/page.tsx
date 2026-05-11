import { redirect } from 'next/navigation';
import { CircleDollarSign, ReceiptText, WalletCards } from 'lucide-react';
import { prisma } from '@sendero/database';

import { Card, CardContent } from '@/components/ui/card';
import { requirePlatformRole } from '@/lib/access';

const MICRO_USDC = 1_000_000n;
const WINDOW_DAYS = 30;

type TenantRollup = {
  tenantId: string | null;
  _sum: { priceMicroUsdc?: bigint | null; totalMicroUsdc?: bigint | null };
  _count: { _all: number };
};

function money(value: bigint | number | null | undefined) {
  const micro = typeof value === 'bigint' ? value : BigInt(value ?? 0);
  const dollars = micro / MICRO_USDC;
  const cents = (micro % MICRO_USDC) / 10_000n;
  return `$${dollars.toLocaleString()}.${cents.toString().padStart(2, '0')}`;
}

function percent(value: bigint, total: bigint) {
  if (total <= 0n) return '0%';
  return `${Number((value * 1000n) / total) / 10}%`;
}

function tenantSumMap(rows: TenantRollup[], key: 'priceMicroUsdc' | 'totalMicroUsdc') {
  return new Map(rows.flatMap(row => (row.tenantId ? [[row.tenantId, row._sum[key] ?? 0n]] : [])));
}

export default async function BillingPage() {
  const access = await requirePlatformRole(['superadmin', 'finance']);
  if (!access.ok) redirect('/unauthorized');

  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const [
    tenants,
    meterByTenant,
    meterByTool,
    settledNanopayByTenant,
    openInvoices,
    platformBills,
    batchesByStatus,
  ] = await Promise.all([
    prisma.tenant.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 24,
      select: {
        id: true,
        displayName: true,
        slug: true,
        billingTier: true,
        primaryChain: true,
      },
    }),
    prisma.meterEvent.groupBy({
      by: ['tenantId'],
      where: { at: { gte: since }, status: 'paid' },
      _sum: { priceMicroUsdc: true },
      _count: { _all: true },
    }),
    prisma.meterEvent.groupBy({
      by: ['toolName'],
      where: { at: { gte: since }, status: 'paid' },
      _sum: { priceMicroUsdc: true },
      _count: { _all: true },
      orderBy: { _sum: { priceMicroUsdc: 'desc' } },
      take: 12,
    }),
    prisma.nanopayBatch.groupBy({
      by: ['tenantId'],
      where: { windowStartedAt: { gte: since }, status: 'settled' },
      _sum: { totalMicroUsdc: true },
      _count: { _all: true },
    }),
    prisma.invoice.aggregate({
      where: { status: { in: ['issued', 'sent', 'viewed', 'overdue'] } },
      _sum: { totalMicro: true },
      _count: { _all: true },
    }),
    prisma.invoice.aggregate({
      where: {
        kind: 'platform_bill',
        status: { in: ['issued', 'sent', 'viewed', 'paid', 'overdue'] },
        issuedAt: { gte: since },
      },
      _sum: { totalMicro: true },
      _count: { _all: true },
    }),
    prisma.nanopayBatch.groupBy({
      by: ['status'],
      where: { windowStartedAt: { gte: since } },
      _sum: { totalMicroUsdc: true },
      _count: { _all: true },
    }),
  ]);

  const usageByTenant = tenantSumMap(meterByTenant, 'priceMicroUsdc');
  const settledByTenant = tenantSumMap(settledNanopayByTenant, 'totalMicroUsdc');
  const totalUsage = [...usageByTenant.values()].reduce((sum, value) => sum + value, 0n);
  const totalSettled = [...settledByTenant.values()].reduce((sum, value) => sum + value, 0n);
  const totalCalls = meterByTenant.reduce((sum, row) => sum + row._count._all, 0);
  const pendingBatchMicro = batchesByStatus
    .filter(row => row.status === 'pending' || row.status === 'settling')
    .reduce((sum, row) => sum + (row._sum.totalMicroUsdc ?? 0n), 0n);

  const tenantRows = tenants
    .map(tenant => ({
      tenant,
      usage: usageByTenant.get(tenant.id) ?? 0n,
      settled: settledByTenant.get(tenant.id) ?? 0n,
    }))
    .sort((a, b) => Number(b.usage - a.usage));

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm text-[color:var(--color-muted-foreground)]">
            <CircleDollarSign className="h-4 w-4" />
            Billing
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Revenue and usage</h1>
          <p className="mt-2 max-w-2xl text-sm text-[color:var(--color-muted-foreground)]">
            Human buyers see platform access, included usage, and transparent overages. The nanopay
            ledger stays internal for MCP agents, tool metering, and settlement.
          </p>
        </div>
        <div className="rounded-lg border bg-[color:var(--color-card)] px-4 py-3 text-sm">
          <p className="font-medium">Business unit rollup</p>
          <p className="text-xs text-[color:var(--color-muted-foreground)]">
            vertical agent → business → tenant → tool
          </p>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-4">
        <Metric label={`${WINDOW_DAYS}d tool usage`} value={money(totalUsage)} />
        <Metric label="Tool calls" value={totalCalls.toLocaleString()} />
        <Metric label="Open invoices" value={money(openInvoices._sum.totalMicro)} />
        <Metric label="Pending settlement" value={money(pendingBatchMicro)} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <div className="overflow-hidden rounded-lg border bg-[color:var(--color-card)]">
          <div className="border-b px-4 py-3">
            <h2 className="font-medium">Tenant billing rollup</h2>
            <p className="text-xs text-[color:var(--color-muted-foreground)]">
              Usage overage rail, not customer-facing nanopayment pricing.
            </p>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-[color:var(--color-muted)] text-left text-xs text-[color:var(--color-muted-foreground)] uppercase">
              <tr>
                <th className="px-4 py-3 font-medium">Tenant</th>
                <th className="px-4 py-3 font-medium">Plan</th>
                <th className="px-4 py-3 font-medium">Usage</th>
                <th className="px-4 py-3 font-medium">Settled</th>
                <th className="px-4 py-3 text-right font-medium">Share</th>
              </tr>
            </thead>
            <tbody>
              {tenantRows.map(row => (
                <tr key={row.tenant.id} className="border-t">
                  <td className="px-4 py-3">
                    <div className="font-medium">{row.tenant.displayName}</div>
                    <div className="text-xs text-[color:var(--color-muted-foreground)]">
                      {row.tenant.slug} · {row.tenant.primaryChain}
                    </div>
                  </td>
                  <td className="px-4 py-3 capitalize">{row.tenant.billingTier}</td>
                  <td className="px-4 py-3 font-medium">{money(row.usage)}</td>
                  <td className="px-4 py-3">{money(row.settled)}</td>
                  <td className="px-4 py-3 text-right">{percent(row.usage, totalUsage)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="space-y-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <ReceiptText className="h-4 w-4" />
                SaaS invoice rail
              </div>
              <p className="mt-3 text-2xl font-semibold">{money(platformBills._sum.totalMicro)}</p>
              <p className="mt-1 text-xs text-[color:var(--color-muted-foreground)]">
                {platformBills._count._all} platform bill(s) in this window.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <WalletCards className="h-4 w-4" />
                Nanopay ledger
              </div>
              <p className="mt-3 text-2xl font-semibold">{money(totalSettled)}</p>
              <p className="mt-1 text-xs text-[color:var(--color-muted-foreground)]">
                Settled internal metering, separate from buyer-facing pricing.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border bg-[color:var(--color-card)]">
        <div className="border-b px-4 py-3">
          <h2 className="font-medium">Top tools by usage</h2>
          <p className="text-xs text-[color:var(--color-muted-foreground)]">
            MCP agent pricing uses x402. TMC billing rolls these into usage blocks and overages.
          </p>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-[color:var(--color-muted)] text-left text-xs text-[color:var(--color-muted-foreground)] uppercase">
            <tr>
              <th className="px-4 py-3 font-medium">Tool</th>
              <th className="px-4 py-3 font-medium">Calls</th>
              <th className="px-4 py-3 text-right font-medium">Usage</th>
            </tr>
          </thead>
          <tbody>
            {meterByTool.map(row => (
              <tr key={row.toolName} className="border-t">
                <td className="px-4 py-3 font-mono text-xs">{row.toolName}</td>
                <td className="px-4 py-3">{row._count._all.toLocaleString()}</td>
                <td className="px-4 py-3 text-right font-medium">
                  {money(row._sum.priceMicroUsdc)}
                </td>
              </tr>
            ))}
            {meterByTool.length === 0 ? (
              <tr>
                <td
                  colSpan={3}
                  className="px-4 py-10 text-center text-sm text-[color:var(--color-muted-foreground)]"
                >
                  No paid tool events in this window.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
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
