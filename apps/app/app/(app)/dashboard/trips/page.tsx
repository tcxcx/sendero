import { Button } from '@sendero/ui/button';
import Link from 'next/link';
import { PageHeader } from '@/components/app-shell/page-header';
import { EmptyState } from '@/components/shared/empty-state';
import { PagePagination } from '@/components/shared/page-pagination';
import { PrefundSheet } from '@/components/trips/prefund-sheet/prefund-sheet';
import { TripsTable } from '@/components/trips/trips-table';
import { getAppCopy } from '@/lib/app-copy';
import { parseListQuery } from '@/lib/parse-list-query';
import { getRequestLocale } from '@/lib/request-locale';
import { requireCurrentTenant } from '@/lib/tenant-context';
import { prisma, type Prisma } from '@sendero/database';

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

  const [trips, total] = await Promise.all([
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
      },
    }),
    prisma.trip.count({ where }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / query.per));

  return (
    <>
      <PageHeader
        title={copy.title}
        description={copy.description}
        actions={
          <Button asChild>
            <Link href="/dashboard/trips?sheet=new">{copy.createCta}</Link>
          </Button>
        }
      />
      {trips.length === 0 ? (
        <EmptyState
          title={copy.emptyTitle}
          description={copy.emptyDescription}
          cta={{ label: copy.createCta, href: '/dashboard/trips?sheet=new' }}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <TripsTable trips={trips} />
          <PagePagination
            page={query.page}
            totalPages={totalPages}
            baseUrl="/dashboard/trips"
            searchParams={params}
          />
        </div>
      )}
      <PrefundSheet open={params.sheet === 'new'} />
    </>
  );
}
