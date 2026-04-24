import { auth } from '@clerk/nextjs/server';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/app-shell/page-header';
import { RetryButton } from '@/components/admin/retry-button';
import { DownloadPdfButton } from '@/components/invoices/download-pdf-button';
import { InvoiceDetailView } from '@/components/invoices/invoice-detail-view';
import { requireCurrentTenant } from '@/lib/tenant-context';
import { prisma } from '@sendero/database';

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
    },
  });
  if (!invoice) notFound();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Invoice detail"
        description="Native invoice view with secure PDF download."
        actions={
          <div className="flex flex-wrap items-start gap-2">
            {canRetry ? (
              <RetryButton kind="invoice-pdf" id={invoice.id} label="Retry PDF render" />
            ) : null}
            <DownloadPdfButton invoiceId={invoice.id} number={invoice.number} />
          </div>
        }
      />
      <InvoiceDetailView invoice={invoice} />
    </div>
  );
}
