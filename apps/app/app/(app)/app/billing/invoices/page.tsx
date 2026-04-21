import { PageHeader } from '@/components/app-shell/page-header';
import { EmptyState } from '@/components/shared/empty-state';
import { PagePagination } from '@/components/shared/page-pagination';
import { InvoiceFilters } from '@/components/invoices/invoice-filters';
import { InvoicesTable } from '@/components/invoices/invoices-table';
import { parseListQuery } from '@/lib/parse-list-query';
import { requireCurrentTenant } from '@/lib/tenant-context';
import { prisma, type Prisma } from '@sendero/database';

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
  const params = await searchParams;
  const query = parseListQuery(params, { knownFilters: ['status', 'kind', 'period'] });
  const status =
    query.filters.status && query.filters.status !== 'all' ? query.filters.status : undefined;
  const kind = query.filters.kind && query.filters.kind !== 'all' ? query.filters.kind : undefined;
  const period =
    query.filters.period && query.filters.period !== 'all' ? query.filters.period : undefined;
  const where: Prisma.InvoiceWhereInput = {
    tenantId: tenant.id,
    ...(status ? { status: status as any } : {}),
    ...(kind ? { kind: kind as any } : {}),
    ...periodFilter(period),
  };

  const [invoices, total] = await Promise.all([
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
      },
    }),
    prisma.invoice.count({ where }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / query.per));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Invoices" description="Review issued, unpaid, and paid invoices." />
      <InvoiceFilters status={status} kind={kind} period={period} />
      {invoices.length === 0 ? (
        <EmptyState
          title="No invoices found"
          description="Invoices will appear here after bookings or platform bills are issued."
        />
      ) : (
        <>
          <InvoicesTable invoices={invoices} />
          <PagePagination
            page={query.page}
            totalPages={totalPages}
            baseUrl="/app/billing/invoices"
            searchParams={params}
          />
        </>
      )}
    </div>
  );
}
