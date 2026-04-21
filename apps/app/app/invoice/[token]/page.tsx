/**
 * Public invoice viewer at /invoice/[token].
 *
 * Node runtime, no auth — the JWT in the URL is the capability. Verifies,
 * loads the invoice scoped to the token's tenantId, renders the HTML
 * template inline + a Download PDF button that round-trips through the
 * token-auth branch of /api/invoices/[id]/pdf.
 *
 * Side-effect: flips invoice.status 'sent' -> 'viewed' on first open.
 */

import { notFound } from 'next/navigation';
import { prisma } from '@sendero/database';
import {
  verifyInvoiceToken,
  invoiceToTemplateProps,
  renderInvoiceHtml,
  type InvoiceTokenPayload,
} from '@sendero/invoicing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function PublicInvoicePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const secret = process.env.INVOICE_SIGNING_SECRET;
  if (!secret) notFound();

  let payload: InvoiceTokenPayload;
  try {
    payload = await verifyInvoiceToken(token, secret);
  } catch {
    notFound();
  }

  const invoice = await prisma.invoice.findUnique({
    where: { id: payload.iid },
    include: {
      lineItems: { orderBy: { position: 'asc' } },
      tenant: { select: { brandLogoUrl: true, brandColors: true } },
    },
  });
  if (!invoice || invoice.tenantId !== payload.tenantId) notFound();

  // Mark 'sent' -> 'viewed' on first open (best-effort, non-blocking).
  if (invoice.status === 'sent') {
    prisma.invoice
      .update({ where: { id: invoice.id }, data: { status: 'viewed' } })
      .catch(() => {});
  }

  const props = invoiceToTemplateProps({
    invoice,
    tenant: invoice.tenant,
    baseUrl: process.env.NEXT_PUBLIC_APP_URL,
  });

  // renderInvoiceHtml returns a full `<!doctype html>...</html>` string. We
  // extract the <body> inner content so React doesn't nest <html>/<body>
  // inside the App Router's own document wrapping.
  const html = await renderInvoiceHtml(props);
  const innerMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const innerBody = innerMatch ? innerMatch[1] : html;

  return (
    <main style={{ background: '#f5f2ee', minHeight: '100vh' }}>
      <div dangerouslySetInnerHTML={{ __html: innerBody }} />
      <div style={{ textAlign: 'center', padding: '32px 16px' }}>
        <a
          href={`/api/invoices/${invoice.id}/pdf?token=${encodeURIComponent(token)}`}
          style={{
            display: 'inline-block',
            background: '#fb542b',
            color: '#fff',
            padding: '14px 28px',
            borderRadius: 12,
            textDecoration: 'none',
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          Download PDF
        </a>
      </div>
    </main>
  );
}
