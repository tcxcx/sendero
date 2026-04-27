/**
 * /dashboard/billing/invoices — InvListA layout.
 *
 *   Crumb · header · 4 KPI strip (real Prisma aggregates) · status
 *   chip filter · editorial grid table · pagination.
 *
 * KPIs are computed server-side off the same `tenantId` scope:
 *   - MTD billed   sum(totalMicro WHERE createdAt >= start_of_month)
 *   - Open         count of (issued | sent | viewed)
 *   - Past due     count where (status = overdue) OR (dueAt < now AND paidAt IS NULL)
 *   - Avg cycle    mean(paidAt - createdAt) over the last 90 days of paid invoices
 */

import Link from 'next/link';

import { prisma, type InvoiceKind, type InvoiceStatus, type Prisma } from '@sendero/database';

import { InvoicesGrid } from '@/components/invoices/invoices-card-grid';
import { EmptyState } from '@/components/shared/empty-state';
import { PagePagination } from '@/components/shared/page-pagination';
import { formatMicroUsdPrecise } from '@/lib/format';
import { getAppCopy } from '@/lib/app-copy';
import { parseListQuery } from '@/lib/parse-list-query';
import { getRequestLocale } from '@/lib/request-locale';
import { requireCurrentTenant } from '@/lib/tenant-context';

const INVOICE_STATUSES = ['draft', 'issued', 'sent', 'viewed', 'paid', 'overdue', 'void'] as const;
const INVOICE_KINDS = ['booking', 'platform_bill', 'credit_note'] as const;

function parseInvoiceStatus(value: string | undefined): InvoiceStatus | undefined {
  return INVOICE_STATUSES.find(status => status === value);
}

function parseInvoiceKind(value: string | undefined): InvoiceKind | undefined {
  return INVOICE_KINDS.find(kind => kind === value);
}

function periodFilter(period?: string): Prisma.InvoiceWhereInput {
  const now = new Date();
  if (period === 'this_month') {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return { createdAt: { gte: start } };
  }
  if (period === 'last_month') {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return { createdAt: { gte: start, lt: end } };
  }
  if (period === 'ytd') {
    const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    return { createdAt: { gte: start } };
  }
  return {};
}

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { tenant } = await requireCurrentTenant();
  const locale = await getRequestLocale();
  const copy = getAppCopy(locale).invoices;
  const params = await searchParams;
  const query = parseListQuery(params, { knownFilters: ['status', 'kind', 'period'] });
  const status =
    query.filters.status && query.filters.status !== 'all'
      ? parseInvoiceStatus(query.filters.status)
      : undefined;
  const kind =
    query.filters.kind && query.filters.kind !== 'all'
      ? parseInvoiceKind(query.filters.kind)
      : undefined;
  const period =
    query.filters.period && query.filters.period !== 'all' ? query.filters.period : undefined;
  const where: Prisma.InvoiceWhereInput = {
    tenantId: tenant.id,
    ...(status ? { status } : {}),
    ...(kind ? { kind } : {}),
    ...periodFilter(period),
  };

  const now = new Date();
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const startOfPrevMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  const [invoices, total, mtd, prevMtd, openAgg, overdueAgg, paidRecent, statusGroups] =
    await Promise.all([
      prisma.invoice.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.take,
        select: {
          id: true,
          number: true,
          kind: true,
          status: true,
          toName: true,
          totalMicro: true,
          issuedAt: true,
          createdAt: true,
          booking: { select: { tripId: true } },
        },
      }),
      prisma.invoice.count({ where }),
      prisma.invoice.aggregate({
        where: { tenantId: tenant.id, createdAt: { gte: startOfMonth } },
        _sum: { totalMicro: true },
      }),
      prisma.invoice.aggregate({
        where: {
          tenantId: tenant.id,
          createdAt: { gte: startOfPrevMonth, lt: startOfMonth },
        },
        _sum: { totalMicro: true },
      }),
      prisma.invoice.aggregate({
        where: { tenantId: tenant.id, status: { in: ['issued', 'sent', 'viewed'] } },
        _count: { _all: true },
        _sum: { totalMicro: true },
      }),
      prisma.invoice.aggregate({
        where: {
          tenantId: tenant.id,
          OR: [
            { status: 'overdue' },
            { AND: [{ paidAt: null }, { dueAt: { lt: now } }, { status: { not: 'void' } }] },
          ],
        },
        _count: { _all: true },
        _sum: { totalMicro: true },
      }),
      prisma.invoice.findMany({
        where: {
          tenantId: tenant.id,
          status: 'paid',
          paidAt: { gte: ninetyDaysAgo },
        },
        select: { paidAt: true, createdAt: true },
        take: 200,
      }),
      prisma.invoice.groupBy({
        by: ['status'],
        where: { tenantId: tenant.id },
        _count: { _all: true },
      }),
    ]);

  const totalPages = Math.max(1, Math.ceil(total / query.per));

  const mtdSum = mtd._sum.totalMicro ?? 0n;
  const prevMtdSum = prevMtd._sum.totalMicro ?? 0n;
  const mtdDeltaPct =
    prevMtdSum === 0n ? null : Number(((mtdSum - prevMtdSum) * 100n) / prevMtdSum);
  const openCount = openAgg._count._all;
  const openSum = openAgg._sum.totalMicro ?? 0n;
  const overdueCount = overdueAgg._count._all;
  const overdueSum = overdueAgg._sum.totalMicro ?? 0n;
  const avgCycleDays = computeAvgCycleDays(paidRecent);

  const rows = invoices.map(i => ({
    id: i.id,
    number: i.number,
    kind: i.kind,
    status: i.status,
    toName: i.toName,
    totalMicro: i.totalMicro,
    issuedAt: i.issuedAt,
    createdAt: i.createdAt,
    bookingTripId: i.booking?.tripId ?? null,
  }));

  return (
    <div
      style={{
        padding: '0 20px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        flex: 1,
        minHeight: 0,
      }}
    >
      <div>
        <h1 className="t-h1">Invoices</h1>
        <p className="t-body-lg ink-70" style={{ marginTop: 6, maxWidth: '60ch' }}>
          Settled in nano-USDC on Arc L2. Full audit trail on every line.
        </p>
      </div>

      <KpiStrip
        items={[
          {
            label: 'MTD billed',
            value: formatMicroUsdPrecise(mtdSum),
            sub:
              mtdDeltaPct === null ? '—' : `${mtdDeltaPct >= 0 ? '+' : ''}${mtdDeltaPct}% vs last`,
          },
          {
            label: 'Open',
            value: formatMicroUsdPrecise(openSum),
            sub: `${openCount} invoice${openCount === 1 ? '' : 's'}`,
          },
          {
            label: 'Past due',
            value: formatMicroUsdPrecise(overdueSum),
            sub: overdueCount === 0 ? 'clean' : `${overdueCount} overdue`,
          },
          {
            label: 'Avg cycle',
            value: avgCycleDays === null ? '—' : `${avgCycleDays.toFixed(1)}d`,
            sub: avgCycleDays === null ? 'no paid invoices yet' : 'last 90d',
          },
        ]}
      />

      <StatusFilterBar
        active={status ?? null}
        groups={statusGroups}
        baseHref="/dashboard/billing/invoices"
        params={params}
      />

      {invoices.length === 0 ? (
        <EmptyState title={copy.emptyTitle} description={copy.emptyDescription} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, flex: 1, minHeight: 0 }}>
          <InvoicesGrid invoices={rows} />
          <PagePagination
            page={query.page}
            totalPages={totalPages}
            baseUrl="/dashboard/billing/invoices"
            searchParams={params}
          />
        </div>
      )}
    </div>
  );
}

// ── KPI strip ────────────────────────────────────────────────

function KpiStrip({ items }: { items: Array<{ label: string; value: string; sub: string }> }) {
  return (
    <div
      className="sd-card-flat"
      style={{
        boxShadow: 'inset 0 0 0 1px var(--hairline-color)',
        padding: '4px 0',
        display: 'flex',
        alignItems: 'stretch',
      }}
    >
      {items.map((k, i) => (
        <div
          key={k.label}
          style={{
            flex: 1,
            padding: '14px 24px 16px',
            borderRight: i < items.length - 1 ? '1px solid var(--hairline-color)' : 'none',
            minWidth: 0,
          }}
        >
          <div className="t-meta">{k.label}</div>
          <div
            className="t-num-lg"
            style={{
              fontSize: 36,
              marginTop: 6,
              lineHeight: 1,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {k.value}
          </div>
          <div className="t-mono ink-60" style={{ fontSize: 11, marginTop: 6 }}>
            {k.sub}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── status chip filter ───────────────────────────────────────

function StatusFilterBar({
  active,
  groups,
  baseHref,
  params,
}: {
  active: string | null;
  groups: Array<{ status: string; _count: { _all: number } }>;
  baseHref: string;
  params: Record<string, string | string[] | undefined>;
}) {
  const total = groups.reduce((acc, g) => acc + g._count._all, 0);
  const items: Array<{ value: string | null; label: string; count: number }> = [
    { value: null, label: 'All', count: total },
    {
      value: 'sent',
      label: 'Sent',
      count: groups.find(g => g.status === 'sent')?._count._all ?? 0,
    },
    {
      value: 'paid',
      label: 'Paid',
      count: groups.find(g => g.status === 'paid')?._count._all ?? 0,
    },
    {
      value: 'overdue',
      label: 'Overdue',
      count: groups.find(g => g.status === 'overdue')?._count._all ?? 0,
    },
    {
      value: 'void',
      label: 'Void',
      count: groups.find(g => g.status === 'void')?._count._all ?? 0,
    },
  ];
  const linkFor = (value: string | null) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (k === 'status' || k === 'page' || Array.isArray(v) || !v) continue;
      next.set(k, v);
    }
    if (value) next.set('status', value);
    const qs = next.toString();
    return qs ? `${baseHref}?${qs}` : baseHref;
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span className="t-meta">Filter</span>
      {items.map(item => {
        const isActive = (active ?? null) === item.value;
        return (
          <Link
            key={item.label}
            href={linkFor(item.value)}
            className="sd-pill"
            style={{
              padding: '4px 10px',
              fontSize: 11,
              fontFamily: 'var(--font-mono-x)',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              textDecoration: 'none',
              background: isActive ? 'var(--vermillion)' : 'var(--surface-floating)',
              color: isActive ? '#fdfbf7' : 'var(--midnight)',
              boxShadow: isActive ? 'none' : 'inset 0 0 0 1px var(--hairline-color)',
            }}
          >
            {item.label} · {item.count}
          </Link>
        );
      })}
    </div>
  );
}

// ── helpers ─────────────────────────────────────────────────

function computeAvgCycleDays(rows: Array<{ paidAt: Date | null; createdAt: Date }>): number | null {
  const cycles: number[] = [];
  for (const r of rows) {
    if (!r.paidAt) continue;
    const d = (r.paidAt.getTime() - r.createdAt.getTime()) / (1000 * 60 * 60 * 24);
    if (Number.isFinite(d) && d >= 0) cycles.push(d);
  }
  if (cycles.length === 0) return null;
  const sum = cycles.reduce((a, b) => a + b, 0);
  return sum / cycles.length;
}
