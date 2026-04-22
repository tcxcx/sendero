import { Button } from '@sendero/ui/button';
import Link from 'next/link';
import { PageHeader } from '@/components/app-shell/page-header';
import { EmptyState } from '@/components/shared/empty-state';
import { PagePagination } from '@/components/shared/page-pagination';
import { PrefundSheet } from '@/components/trips/prefund-sheet/prefund-sheet';
import { TripsTable } from '@/components/trips/trips-table';
import { parseListQuery } from '@/lib/parse-list-query';
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
        title="Trips"
        description="Create prepaid escrow links, send them to travelers, and monitor booking drawdown."
        actions={
          <Button asChild>
            <Link href="/app/trips?sheet=new">Create prepaid trip</Link>
          </Button>
        }
      />
      {trips.length === 0 ? (
        <EmptyState
          title="No trips yet"
          description="Create a prepaid trip, copy the claim link into WhatsApp or Slack, and let the traveler claim their Arc escrow budget."
          cta={{ label: 'Create prepaid trip', href: '/app/trips?sheet=new' }}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <TripsTable trips={trips} />
          <PagePagination
            page={query.page}
            totalPages={totalPages}
            baseUrl="/app/trips"
            searchParams={params}
          />
        </div>
      )}
      <PrefundSheet open={params.sheet === 'new'} />
    </>
  );
}
