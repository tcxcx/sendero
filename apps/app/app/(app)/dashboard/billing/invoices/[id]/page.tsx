/**
 * /dashboard/billing/invoices/[id] — InvDetailA layout.
 *
 * The "document" + right-rail split is rendered inside
 * `<InvoiceDetailView />`. The detail page is responsible for the
 * crumb, fetching the invoice (with payments + line items + booking ·
 * trip · traveler), and mounting the right-rail action buttons that
 * actually have an API behind them today (Download PDF, optionally
 * admin-only Retry PDF render).
 */

import { auth } from '@clerk/nextjs/server';
import { notFound } from 'next/navigation';

import { prisma } from '@sendero/database';

import { RetryButton } from '@/components/admin/retry-button';
import { DownloadPdfButton } from '@/components/invoices/download-pdf-button';
import { InvoiceDetailView } from '@/components/invoices/invoice-detail-view';
import { requireCurrentTenant } from '@/lib/tenant-context';

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { tenant } = await requireCurrentTenant();
  const { has } = await auth();
  const canRetry = has({ role: 'org:admin' });
  const invoice = await prisma.invoice.findFirst({
    where: { id, tenantId: tenant.id },
    include: {
      lineItems: { orderBy: { position: 'asc' } },
      payments: { orderBy: { paidAt: 'desc' } },
      booking: {
        select: {
          tripId: true,
          trip: {
            select: {
              id: true,
              intent: true,
              traveler: { select: { displayName: true, email: true } },
            },
          },
        },
      },
    },
  });
  if (!invoice) notFound();

  return (
    <div
      style={{
        padding: '0 20px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
        flex: 1,
        minHeight: 0,
      }}
    >
      <InvoiceDetailView invoice={invoice} />

      <div
        style={{
          position: 'sticky',
          bottom: 0,
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          padding: '10px 18px',
          background: 'var(--surface-floating)',
          borderTop: '1px solid var(--hairline-color)',
        }}
      >
        <span className="t-meta" style={{ marginRight: 6 }}>
          Actions
        </span>
        <DownloadPdfButton invoiceId={invoice.id} number={invoice.number} />
        {canRetry ? (
          <RetryButton kind="invoice-pdf" id={invoice.id} label="Retry PDF render" />
        ) : null}
      </div>
    </div>
  );
}
