import Link from 'next/link';

import { prisma, type Prisma } from '@sendero/database';
import { Button } from '@sendero/ui/button';

import { Crumb } from '@/components/console/crumb';
import { PageActions } from '@/components/dashboard/page-actions';
import { EmptyState } from '@/components/shared/empty-state';
import { PagePagination } from '@/components/shared/page-pagination';
import { PrefundSheet } from '@/components/trips/prefund-sheet/prefund-sheet';
import { TripsCardGrid } from '@/components/trips/trips-card-grid';
import { getAppCopy } from '@/lib/app-copy';
import { parseListQuery } from '@/lib/parse-list-query';
import { getRequestLocale } from '@/lib/request-locale';
import { requireCurrentTenant } from '@/lib/tenant-context';

const TRIP_STATUSES = [
  'draft',
  'searching',
  'awaiting_approval',
  'booked',
  'in_progress',
  'completed',
  'canceled',
  'failed',
] as const;

function parseTripStatus(value: string | undefined) {
  return TRIP_STATUSES.find(status => status === value);
}

export default async function TripsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { tenant } = await requireCurrentTenant();
  const locale = await getRequestLocale();
  const copy = getAppCopy(locale).trips;
  const params = await searchParams;
  const query = parseListQuery(params, { knownFilters: ['status'] });
  const status = parseTripStatus(query.filters.status);
  const where: Prisma.TripWhereInput = {
    tenantId: tenant.id,
    ...(status ? { status } : {}),
  };

  const [trips, total, summary] = await Promise.all([
    prisma.trip.findMany({
      where,
      skip: query.skip,
      take: query.take,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        intent: true,
        metadata: true,
        totalUsdc: true,
        status: true,
        createdAt: true,
        traveler: { select: { displayName: true, email: true } },
      },
    }),
    prisma.trip.count({ where }),
    prisma.trip.groupBy({
      by: ['status'],
      where: { tenantId: tenant.id },
      _count: { _all: true },
    }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / query.per));

  const inflight = countOf(summary, ['booked', 'in_progress']);
  const awaiting = countOf(summary, ['awaiting_approval']);
  const settledThisWeek = await prisma.trip.count({
    where: {
      tenantId: tenant.id,
      status: 'completed',
      updatedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    },
  });

  return (
    <div
      style={{
        padding: '24px 28px',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        flex: 1,
        minHeight: 0,
      }}
    >
      <Crumb trail={['Workspace', 'Trips']} />

      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 24,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h1 className="t-h1">Trips</h1>
          <p className="t-body-lg ink-70" style={{ marginTop: 6, maxWidth: '60ch' }}>
            {inflight} in flight, {awaiting} awaiting approval, {settledThisWeek} settled this week.
          </p>
        </div>
        <PageActions>
          <Button asChild>
            <Link href="/dashboard/trips?sheet=new">{copy.createCta}</Link>
          </Button>
        </PageActions>
      </div>

      <StatusFilterBar
        active={status ?? null}
        summary={summary}
        baseHref="/dashboard/trips"
        params={params}
      />

      {trips.length === 0 ? (
        <EmptyState
          title={copy.emptyTitle}
          description={copy.emptyDescription}
          cta={{ label: copy.createCta, href: '/dashboard/trips?sheet=new' }}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, flex: 1, minHeight: 0 }}>
          <TripsCardGrid trips={trips} />
          <PagePagination
            page={query.page}
            totalPages={totalPages}
            baseUrl="/dashboard/trips"
            searchParams={params}
          />
        </div>
      )}

      <PrefundSheet open={params.sheet === 'new'} />
    </div>
  );
}

function countOf(
  groups: Array<{ status: string; _count: { _all: number } }>,
  statuses: string[]
): number {
  return groups.filter(g => statuses.includes(g.status)).reduce((acc, g) => acc + g._count._all, 0);
}

function StatusFilterBar({
  active,
  summary,
  baseHref,
  params,
}: {
  active: string | null;
  summary: Array<{ status: string; _count: { _all: number } }>;
  baseHref: string;
  params: Record<string, string | string[] | undefined>;
}) {
  const total = summary.reduce((acc, g) => acc + g._count._all, 0);
  const items: Array<{ value: string | null; label: string; count: number }> = [
    { value: null, label: 'All', count: total },
    {
      value: 'awaiting_approval',
      label: 'Awaiting',
      count: countOf(summary, ['awaiting_approval']),
    },
    { value: 'booked', label: 'Holds', count: countOf(summary, ['booked']) },
    { value: 'in_progress', label: 'In flight', count: countOf(summary, ['in_progress']) },
    { value: 'completed', label: 'Settled', count: countOf(summary, ['completed']) },
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
