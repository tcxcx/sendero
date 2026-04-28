/**
 * /dashboard/spend — design-canvas Spend route.
 *
 * Range is controlled by `?range=W|M|Y` (W=7d, M=30d, Y=365d). Legacy
 * `?days=` still resolves so old saved links keep working. Role gate
 * stays admin|finance.  Data plumbing (`tenantSpendSummary`,
 * `tenantSpendCap`, `nanopayBatch`) is unchanged — only the rendering
 * has been redesigned.
 */

import { auth } from '@clerk/nextjs/server';

import { tenantSpendSummary } from '@sendero/billing/analytics';
import { prisma } from '@sendero/database';

import { RetryButton } from '@/components/admin/retry-button';
import { PageActions } from '@/components/dashboard/page-actions';
import { SpendDashboard, type SpendRange } from '@/components/spend/spend-dashboard';
import { requireAnyRole } from '@/lib/require-role';
import { requireCurrentTenant } from '@/lib/tenant-context';

const DAY_MS = 24 * 60 * 60 * 1000;

const RANGE_DAYS: Record<SpendRange, number> = {
  W: 7,
  M: 30,
  Y: 365,
};

function parseRange(value: string | undefined, fallbackDays: number | undefined): SpendRange {
  if (value === 'W' || value === 'M' || value === 'Y') return value;
  if (typeof fallbackDays === 'number') {
    if (fallbackDays >= 180) return 'Y';
    if (fallbackDays >= 21) return 'M';
  }
  return 'W';
}

export default async function SpendPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; days?: string }>;
}) {
  await requireAnyRole(['org:admin', 'org:finance']);
  const { tenant } = await requireCurrentTenant();
  const { has } = await auth();
  const canRetry = has({ role: 'org:admin' });
  const params = await searchParams;
  const legacyDays = params.days ? Math.min(Math.max(Number(params.days), 1), 365) : undefined;
  const range = parseRange(params.range, legacyDays);
  const days = RANGE_DAYS[range];

  const now = new Date();
  const from = new Date(now.getTime() - days * DAY_MS);

  const [summary, caps, recentBatches, settlementSplit] = await Promise.all([
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
    // Pending vs reconciled split — same window as the summary.
    // `pending` = paid events not yet attached to a settled batch
    // (cron will pick them up at the next */5 sweep). `reconciled` =
    // events with a settlementRef pointing at a batch in any state.
    Promise.all([
      prisma.meterEvent.aggregate({
        where: {
          tenantId: tenant.id,
          status: 'paid',
          settlementRef: null,
          at: { gte: from, lte: now },
        },
        _sum: { priceMicroUsdc: true },
        _count: true,
      }),
      prisma.meterEvent.aggregate({
        where: {
          tenantId: tenant.id,
          status: 'paid',
          settlementRef: { not: null },
          at: { gte: from, lte: now },
        },
        _sum: { priceMicroUsdc: true },
        _count: true,
      }),
    ]).then(([pending, reconciled]) => ({
      pendingMicro: pending._sum.priceMicroUsdc ?? 0n,
      pendingCount: pending._count,
      reconciledMicro: reconciled._sum.priceMicroUsdc ?? 0n,
      reconciledCount: reconciled._count,
    })),
  ]);

  return (
    <>
      {canRetry ? (
        <PageActions>
          <RetryButton kind="failed-batches" label="Retry failed batches" />
        </PageActions>
      ) : null}
      <SpendDashboard
        tenantName={tenant.displayName}
        tier={tenant.billingTier}
        range={range}
        summary={summary}
        caps={caps}
        recentBatches={recentBatches}
        settlementSplit={settlementSplit}
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
