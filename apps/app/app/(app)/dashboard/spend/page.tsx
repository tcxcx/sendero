import { auth } from '@clerk/nextjs/server';
import { PageHeader } from '@/components/app-shell/page-header';
import { RetryButton } from '@/components/admin/retry-button';
import { SpendDashboard } from '@/components/spend/spend-dashboard';
import { requireAnyRole } from '@/lib/require-role';
import { requireCurrentTenant } from '@/lib/tenant-context';
import { tenantSpendSummary } from '@sendero/billing/analytics';
import { prisma } from '@sendero/database';

const DAY_MS = 24 * 60 * 60 * 1000;

export default async function SpendPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  await requireAnyRole(['org:admin', 'org:finance']);
  const { tenant } = await requireCurrentTenant();
  const { has } = await auth();
  const canRetry = has({ role: 'org:admin' });
  const params = await searchParams;
  const days = Math.min(Math.max(Number(params.days ?? 7), 1), 90);
  const now = new Date();
  const from = new Date(now.getTime() - days * DAY_MS);

  const [summary, caps, recentBatches] = await Promise.all([
    tenantSpendSummary(makeAnalyticsStore(), { tenantId: tenant.id, from, to: now, bucket: 'day' }),
    prisma.tenantSpendCap.findMany({
      where: { tenantId: tenant.id },
      select: { period: true, amountMicroUsdc: true, hardCap: true },
      orderBy: { period: 'asc' },
    }),
    prisma.nanopayBatch.findMany({
      where: { tenantId: tenant.id },
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: {
        id: true,
        status: true,
        totalMicroUsdc: true,
        eventCount: true,
        txHash: true,
        settledAt: true,
        createdAt: true,
      },
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Spend"
        description="Nanopayment spend, caps, and recent settlement batches."
        actions={
          canRetry ? <RetryButton kind="failed-batches" label="Retry failed batches" /> : null
        }
      />
      <SpendDashboard
        tenantName={tenant.displayName}
        tier={tenant.billingTier}
        days={days}
        summary={summary}
        caps={caps}
        recentBatches={recentBatches}
      />
    </>
  );
}

function makeAnalyticsStore() {
  return {
    sumSpentInWindow: async ({
      tenantId,
      from,
      to,
    }: {
      tenantId: string;
      from: Date;
      to: Date;
    }) => {
      const agg = await prisma.meterEvent.aggregate({
        where: { tenantId, status: 'paid', at: { gte: from, lte: to } },
        _sum: { priceMicroUsdc: true },
      });
      return agg._sum.priceMicroUsdc ?? 0n;
    },
    countCallsInWindow: ({ tenantId, from, to }: { tenantId: string; from: Date; to: Date }) =>
      prisma.meterEvent.count({ where: { tenantId, status: 'paid', at: { gte: from, lte: to } } }),
    spendByToolInWindow: async ({
      tenantId,
      from,
      to,
    }: {
      tenantId: string;
      from: Date;
      to: Date;
    }) => {
      const rows = await prisma.meterEvent.groupBy({
        by: ['toolName'],
        where: { tenantId, status: 'paid', at: { gte: from, lte: to } },
        _count: true,
        _sum: { priceMicroUsdc: true },
      });
      return rows.map(row => ({
        toolName: row.toolName,
        calls: row._count,
        micro: row._sum.priceMicroUsdc ?? 0n,
      }));
    },
    spendTimeseries: async ({
      tenantId,
      from,
      to,
    }: {
      tenantId: string;
      from: Date;
      to: Date;
      bucket: 'hour' | 'day';
    }) => {
      const events = await prisma.meterEvent.findMany({
        where: { tenantId, status: 'paid', at: { gte: from, lte: to } },
        select: { at: true, priceMicroUsdc: true },
        orderBy: { at: 'asc' },
        take: 10_000,
      });
      const buckets = new Map<string, { micro: bigint; calls: number }>();
      for (const event of events) {
        const key = event.at.toISOString().slice(0, 10);
        const bucket = buckets.get(key) ?? { micro: 0n, calls: 0 };
        bucket.micro += event.priceMicroUsdc;
        bucket.calls += 1;
        buckets.set(key, bucket);
      }
      return [...buckets.entries()].map(([key, value]) => ({
        bucketStartedAt: new Date(`${key}T00:00:00Z`),
        ...value,
      }));
    },
  };
}
