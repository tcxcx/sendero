/**
 * GET /api/invoices/[id]/pdf
 *
 * Two auth branches:
 *  1. ?token=<JWT>  — public viewer + emailed "download" link. Verifies
 *     via @sendero/invoicing token helper, rejects if iid mismatches.
 *  2. Clerk org admin/finance — tenant-guarded buyer UI download.
 *  3. Authorization: Bearer <CRON_SECRET> — operational fallback for
 *     existing cron/admin callers.
 *
 * First render writes the PDF to Vercel Blob for subsequent redirects.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { get, put } from '@vercel/blob';
import { prisma } from '@sendero/database';
import {
  renderInvoicePdfBuffer,
  verifyInvoiceToken,
  invoiceToTemplateProps,
} from '@sendero/invoicing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Branch 1: token-based (public viewer + email link)
  const url = new URL(req.url);
  const tokenParam = url.searchParams.get('token');
  if (tokenParam) {
    const secret = process.env.INVOICE_SIGNING_SECRET;
    if (!secret) return new NextResponse(null, { status: 503 });
    try {
      const payload = await verifyInvoiceToken(tokenParam, secret);
      if (payload.iid !== id) return new NextResponse(null, { status: 404 });
      return await serveInvoicePdf(id, payload.tenantId);
    } catch {
      return new NextResponse(null, { status: 404 });
    }
  }

  // Branch 2: authenticated buyer-admin / finance in the active Clerk org.
  const { orgId, has } = await auth();
  if (orgId && (has({ role: 'org:admin' }) || has({ role: 'org:finance' }))) {
    const tenant = await prisma.tenant.findUnique({
      where: { clerkOrgId: orgId },
      select: { id: true },
    });
    if (!tenant) return new NextResponse(null, { status: 404 });
    return await serveInvoicePdf(id, tenant.id);
  }

  // Branch 3: operational fallback for existing cron/admin callers.
  const expected = process.env.CRON_SECRET;
  if (expected && req.headers.get('authorization') === `Bearer ${expected}`) {
    // Trusted caller — no tenant check, treat as admin.
    return await serveInvoicePdf(id, null);
  }

  return new NextResponse(null, { status: 401 });
}

async function serveInvoicePdf(id: string, tenantIdGuard: string | null): Promise<NextResponse> {
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      lineItems: { orderBy: { position: 'asc' } },
      tenant: { select: { brandLogoUrl: true, brandColors: true } },
    },
  });
  if (!invoice) return new NextResponse(null, { status: 404 });
  if (tenantIdGuard && invoice.tenantId !== tenantIdGuard) {
    return new NextResponse(null, { status: 404 });
  }

  // If we already rendered + cached in private Blob, stream it through this
  // authenticated/signed route instead of exposing the blob URL directly.
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (invoice.pdfBlobUrl && blobToken) {
    try {
      const cached = await get(invoice.pdfBlobUrl, {
        access: 'private',
        token: blobToken,
      });
      if (cached?.statusCode === 200 && cached.stream) {
        return new NextResponse(cached.stream, {
          status: 200,
          headers: {
            'Content-Type': cached.blob.contentType ?? 'application/pdf',
            'Content-Disposition': `inline; filename="${invoice.number}.pdf"`,
            'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff',
            ETag: cached.blob.etag,
          },
        });
      }
    } catch (err) {
      console.warn('[invoices/[id]/pdf] private blob read failed; re-rendering:', err);
    }
  }

  // Render on-demand.
  const props = invoiceToTemplateProps({
    invoice,
    tenant: invoice.tenant,
    baseUrl: process.env.NEXT_PUBLIC_APP_URL,
  });
  const buf = await renderInvoicePdfBuffer(props);

  // Upload to Blob (best-effort — if token missing, just serve the buffer directly).
  if (blobToken) {
    try {
      const { url: pdfBlobUrl } = await put(`invoices/${invoice.tenantId}/${invoice.id}.pdf`, buf, {
        access: 'private',
        addRandomSuffix: false,
        contentType: 'application/pdf',
        token: blobToken,
      });
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { pdfBlobUrl, pdfRenderedAt: new Date() },
      });
    } catch (err) {
      console.warn('[invoices/[id]/pdf] blob upload failed:', err);
    }
  }

  return new NextResponse(buf as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${invoice.number}.pdf"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
