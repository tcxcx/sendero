import { PageHeader } from '@/components/app-shell/page-header';
import { EmptyState } from '@/components/shared/empty-state';
import { PagePagination } from '@/components/shared/page-pagination';
import { InvoiceFilters } from '@/components/invoices/invoice-filters';
import { InvoicesTable } from '@/components/invoices/invoices-table';
import { getAppCopy } from '@/lib/app-copy';
import { parseListQuery } from '@/lib/parse-list-query';
import { getRequestLocale } from '@/lib/request-locale';
import { requireCurrentTenant } from '@/lib/tenant-context';
import { prisma, type InvoiceKind, type InvoiceStatus, type Prisma } from '@sendero/database';

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
      <PageHeader title={copy.title} description={copy.description} />
      <InvoiceFilters status={status} kind={kind} period={period} />
      {invoices.length === 0 ? (
        <EmptyState title={copy.emptyTitle} description={copy.emptyDescription} />
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
