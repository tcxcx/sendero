/**
 * Phase-11b Epic 9 — month-end platform bill generation.
 *
 * Runs monthly via Vercel Cron (1st of each month, 02:00 UTC). For
 * every tenant with unbilled `paid` MeterEvents in the prior month,
 * groups events by toolName, creates a platform_bill Invoice with
 * one InvoiceLineItem per tool, and stamps the MeterEvents with
 * invoiceRef so the next run can't re-bill them.
 *
 * Tier-aware:
 *   business | enterprise → NET-30, status=issued, dueAt = issuedAt+30d
 *   free | pro            → prepaid via hourly nanopay batches, so we
 *                           create InvoicePayment rows per covering
 *                           NanopayBatch and mark status=paid (receipt).
 *
 * Auth: CRON_SECRET header match. Vercel injects this automatically.
 * A single bad tenant can't take down the whole cron — each tenant
 * runs inside its own try/catch.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { prisma } from '@sendero/database';
import {
  renderInvoicePdfBuffer,
  invoiceToTemplateProps,
  signInvoiceToken,
  defaultTemplate,
} from '@sendero/invoicing';
import { createNotifier, notificationsConfigured } from '@sendero/notifications';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (expected && req.headers.get('authorization') !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  // Find tenants with any unbilled paid MeterEvents in the period.
  const tenants = await prisma.meterEvent.findMany({
    where: {
      status: 'paid',
      invoiceRef: null,
      at: { gte: periodStart, lt: periodEnd },
      tenantId: { not: null },
    },
    select: { tenantId: true },
    distinct: ['tenantId'],
    take: 500,
  });

  const results: Array<unknown> = [];
  for (const { tenantId } of tenants) {
    if (!tenantId) continue;
    try {
      const r = await generateForTenant(tenantId, periodStart, periodEnd);
      results.push(r);
    } catch (err) {
      results.push({
        tenantId,
        outcome: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({
    period: { periodStart, periodEnd },
    tenantCount: tenants.length,
    results,
  });
}

async function generateForTenant(tenantId: string, periodStart: Date, periodEnd: Date) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return { tenantId, outcome: 'tenant_missing' };

  const events = await prisma.meterEvent.findMany({
    where: {
      tenantId,
      status: 'paid',
      invoiceRef: null,
      at: { gte: periodStart, lt: periodEnd },
    },
    select: { id: true, toolName: true, priceMicroUsdc: true, settlementRef: true },
  });
  if (events.length === 0) return { tenantId, outcome: 'empty' };

  // Group by toolName — one line item per unique tool.
  const groups = new Map<string, { count: number; totalMicro: bigint }>();
  for (const e of events) {
    const g = groups.get(e.toolName) ?? { count: 0, totalMicro: 0n };
    g.count += 1;
    g.totalMicro += e.priceMicroUsdc;
    groups.set(e.toolName, g);
  }

  const lineItems = Array.from(groups.entries()).map(([toolName, g], idx) => ({
    position: idx + 1,
    description: `${toolName} · ${g.count} calls`,
    quantity: g.count,
    unitPriceMicro: g.count > 0 ? g.totalMicro / BigInt(g.count) : 0n,
    amountMicro: g.totalMicro,
    sourceKind: 'meter_event',
    sourceRef: toolName,
  }));

  const totalMicro = Array.from(groups.values()).reduce((acc, g) => acc + g.totalMicro, 0n);

  // Per-tenant/year sequence — atomic increment.
  const year = new Date().getFullYear();
  const seqRow = await prisma.invoiceSequence.upsert({
    where: { tenantId_year: { tenantId, year } },
    create: { tenantId, year, nextSeq: 2 },
    update: { nextSeq: { increment: 1 } },
    select: { nextSeq: true },
  });
  const number = `INV-${year}-${(seqRow.nextSeq - 1).toString().padStart(4, '0')}`;

  // Tier gate — string compat with BillingTier enum.
  const isNet30 =
    tenant.billingTier === 'business' || tenant.billingTier === 'enterprise';
  const issuedAt = new Date();
  const dueAt = isNet30 ? new Date(issuedAt.getTime() + 30 * 24 * 60 * 60 * 1000) : issuedAt;

  // Prepaid tier: look up covering nanopay batches → create payment rows.
  let paymentsData: Array<{ amountMicro: bigint; method: string; txHash: string | null }> = [];
  if (!isNet30) {
    const batchIds = Array.from(
      new Set(events.map(e => e.settlementRef).filter((r): r is string => !!r))
    );
    if (batchIds.length > 0) {
      const batches = await prisma.nanopayBatch.findMany({
        where: { id: { in: batchIds } },
        select: { id: true, totalMicroUsdc: true, txHash: true },
      });
      paymentsData = batches.map(b => ({
        amountMicro: b.totalMicroUsdc,
        method: 'nanopay_batch',
        txHash: b.txHash ?? null,
      }));
    }
  }

  const secret = process.env.INVOICE_SIGNING_SECRET;
  if (!secret) throw new Error('INVOICE_SIGNING_SECRET not set');

  // Create draft with placeholder publicToken — unique col, non-empty on
  // insert; rewritten after we sign against the real invoice id.
  const draft = await prisma.invoice.create({
    data: {
      tenantId,
      kind: 'platform_bill',
      status: isNet30 ? 'issued' : 'paid',
      number,
      issuedAt,
      dueAt,
      paidAt: isNet30 ? null : issuedAt,
      fromName: 'Sendero Travel',
      toName: tenant.legalName ?? tenant.displayName,
      toEmail: tenant.billingContactEmail ?? '',
      toAddress: tenant.billingAddress ?? undefined,
      toTaxId: tenant.taxId,
      currency: 'USD',
      subtotalMicro: totalMicro,
      totalMicro,
      template: defaultTemplate() as object,
      periodStart,
      periodEnd,
      publicToken: `pending-${Date.now()}`,
      lineItems: { create: lineItems },
      payments: { create: paymentsData },
    },
    include: {
      lineItems: { orderBy: { position: 'asc' } },
      tenant: { select: { brandLogoUrl: true, brandColors: true } },
    },
  });

  // Stamp all included MeterEvents so next month's cron returns `empty`.
  await prisma.meterEvent.updateMany({
    where: { id: { in: events.map(e => e.id) } },
    data: { invoiceRef: draft.id },
  });

  // Sign stable public token bound to (invoice id, tenant id).
  const token = await signInvoiceToken({ iid: draft.id, tenantId }, secret);

  // Render PDF + upload to Vercel Blob (best-effort).
  const props = invoiceToTemplateProps({
    invoice: { ...draft, publicToken: token },
    tenant: draft.tenant,
    baseUrl: process.env.NEXT_PUBLIC_APP_URL,
  });
  const buf = await renderInvoicePdfBuffer(props);

  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  let pdfBlobUrl: string | null = null;
  if (blobToken) {
    try {
      const result = await put(
        `invoices/${tenantId}/${draft.id}.pdf`,
        buf,
        {
          access: 'public',
          addRandomSuffix: false,
          contentType: 'application/pdf',
          token: blobToken,
        }
      );
      pdfBlobUrl = result.url;
    } catch (err) {
      console.warn('[generate-platform-bills] blob upload failed:', err);
    }
  }

  await prisma.invoice.update({
    where: { id: draft.id },
    data: {
      publicToken: token,
      pdfBlobUrl,
      pdfRenderedAt: pdfBlobUrl ? new Date() : undefined,
    },
  });

  // Email the billing contact — fire-and-forget but record error on the
  // invoice row if Resend rejects.
  let emailResult:
    | { ok: boolean; id?: string; error?: string; skipped?: boolean }
    | null = null;
  if (notificationsConfigured() && draft.toEmail) {
    const notifier = createNotifier();
    emailResult = await notifier.sendInvoice(draft.toEmail, {
      invoice: props.invoice,
      publicUrl: props.publicUrl,
      pdfBuffer: buf,
    });
    if (!emailResult.ok && !emailResult.skipped) {
      await prisma.invoice.update({
        where: { id: draft.id },
        data: { metadata: { emailError: emailResult.error ?? 'unknown' } },
      });
    }
  }

  return {
    tenantId,
    outcome: 'invoiced',
    invoiceId: draft.id,
    number,
    totalMicro: totalMicro.toString(),
    eventCount: events.length,
    tier: tenant.billingTier,
    isNet30,
    emailResult,
  };
}
