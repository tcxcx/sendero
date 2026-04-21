/**
 * Phase-11b Epic 8 — fires after settle_booking in the workflow.
 *
 * Finds the Booking (matched via externalId on the hex32 escrow
 * bookingId), increments the per-tenant/year InvoiceSequence,
 * atomically creates the Invoice + LineItem + Payment rows, signs the
 * public JWT token, renders the PDF to Vercel Blob, then emails the
 * traveler a copy with the PDF attached.
 *
 * Idempotent on Booking.id — if an Invoice already exists for this
 * booking (Invoice.bookingId is @unique), the existing row is returned
 * without re-rendering or re-sending.
 */

import { prisma } from '@sendero/database';
import {
  buildPublicInvoiceUrl,
  decimalToMicro,
  defaultTemplate,
  invoiceToTemplateProps,
  renderInvoicePdfBuffer,
  signInvoiceToken,
} from '@sendero/invoicing';
import { createNotifier, notificationsConfigured } from '@sendero/notifications';
import { put } from '@vercel/blob';
import { z } from 'zod';

import type { ToolDef } from './types';

const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'hex32 (0x + 64 hex chars)');

const generateBookingInvoiceInput = z.object({
  bookingId: hex32,
  settleTxHash: z.string().optional(),
});

export const generateBookingInvoiceTool: ToolDef = {
  name: 'generate_booking_invoice',
  description:
    'Issue a booking invoice after settle_booking. Creates Invoice + LineItem + Payment rows, renders PDF to Vercel Blob, signs public token, emails the traveler. Idempotent on the booking (unique FK).',
  inputSchema: generateBookingInvoiceInput,
  jsonSchema: {
    type: 'object',
    required: ['bookingId'],
    properties: {
      bookingId: {
        type: 'string',
        description: 'Escrow bookingId hex32 — matched via Booking.externalId.',
      },
      settleTxHash: {
        type: 'string',
        description: 'Tx hash of the settle_booking on-chain call.',
      },
    },
  },
  async handler(raw) {
    const parsed = generateBookingInvoiceInput.parse(raw);

    // Find the Booking via externalId (hex32 from escrow). Phase-11a
    // convention: the escrow bookingId lives in the same column as
    // Duffel order id. A future migration may add a dedicated column.
    const booking = await prisma.booking.findFirst({
      where: { externalId: parsed.bookingId },
      include: {
        tenant: true,
        trip: {
          include: { createdBy: true },
        },
      },
    });
    if (!booking) {
      throw new Error(`booking_not_found: no Booking with externalId=${parsed.bookingId}`);
    }

    // Idempotent: if an invoice already exists for this booking, return it.
    const existing = await prisma.invoice.findUnique({
      where: { bookingId: booking.id },
      select: { id: true, number: true, publicToken: true, pdfBlobUrl: true },
    });
    if (existing) {
      return {
        invoiceId: existing.id,
        number: existing.number,
        publicUrl: buildPublicInvoiceUrl(existing.publicToken, process.env.NEXT_PUBLIC_APP_URL),
        pdfBlobUrl: existing.pdfBlobUrl,
        alreadyExisted: true,
      };
    }

    // Amount conversion: Booking.totalUsd is Decimal(12,2).
    const totalUsd = booking.totalUsd.toString();
    const totalMicro = decimalToMicro(totalUsd);

    // Sequence: per-tenant per-year counter, atomic increment.
    const year = new Date().getFullYear();
    const seqRow = await prisma.invoiceSequence.upsert({
      where: { tenantId_year: { tenantId: booking.tenantId, year } },
      create: { tenantId: booking.tenantId, year, nextSeq: 2 },
      update: { nextSeq: { increment: 1 } },
      select: { nextSeq: true },
    });
    const seqNum = seqRow.nextSeq - 1;
    const number = `INV-${year}-${seqNum.toString().padStart(4, '0')}`;

    // Line item: one per booking, blended total.
    const pnrSuffix = booking.pnr ? ` · PNR ${booking.pnr}` : '';
    const description = `Trip · ${booking.kind}${pnrSuffix}`;

    // JWT signing secret.
    const secret = process.env.INVOICE_SIGNING_SECRET;
    if (!secret) throw new Error('INVOICE_SIGNING_SECRET not set');

    // Recipient from the trip's createdBy user (traveler).
    const toName = booking.trip.createdBy?.displayName ?? 'Guest traveler';
    const toEmail = booking.trip.createdBy?.email ?? '';

    // Create draft invoice with placeholder publicToken (unique col —
    // must be non-empty on insert; we overwrite immediately after we
    // have the generated id to sign the JWT).
    const placeholderToken = `pending-${booking.id}-${Date.now()}`;

    const draft = await prisma.invoice.create({
      data: {
        tenantId: booking.tenantId,
        kind: 'booking',
        status: 'paid',
        number,
        issuedAt: new Date(),
        paidAt: new Date(),
        fromName: booking.tenant.legalName ?? booking.tenant.displayName ?? 'Sendero Travel',
        fromAddress: booking.tenant.billingAddress ?? undefined,
        fromTaxId: booking.tenant.taxId,
        fromLogoUrl: booking.tenant.brandLogoUrl,
        toName,
        toEmail,
        currency: 'USD',
        subtotalMicro: totalMicro,
        totalMicro,
        template: defaultTemplate() as object,
        bookingId: booking.id,
        publicToken: placeholderToken,
        lineItems: {
          create: [
            {
              position: 1,
              description,
              quantity: 1,
              unitPriceMicro: totalMicro,
              amountMicro: totalMicro,
              sourceKind: 'booking',
              sourceRef: booking.id,
            },
          ],
        },
        payments: parsed.settleTxHash
          ? {
              create: [
                {
                  amountMicro: totalMicro,
                  method: 'escrow_settle',
                  txHash: parsed.settleTxHash,
                },
              ],
            }
          : undefined,
      },
      include: {
        lineItems: { orderBy: { position: 'asc' } },
        tenant: { select: { brandLogoUrl: true, brandColors: true } },
      },
    });

    // Now that the invoice row exists, sign a stable public token that
    // binds to the row id + tenant.
    const token = await signInvoiceToken({ iid: draft.id, tenantId: booking.tenantId }, secret);

    // Build template props + render PDF.
    const props = invoiceToTemplateProps({
      invoice: { ...draft, publicToken: token },
      tenant: draft.tenant,
      baseUrl: process.env.NEXT_PUBLIC_APP_URL,
    });
    const buf = await renderInvoicePdfBuffer(props);

    // Upload to Vercel Blob (best-effort — missing token is non-fatal
    // so dev installs without Blob can still exercise the flow).
    const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
    let pdfBlobUrl: string | null = null;
    if (blobToken) {
      try {
        const result = await put(`invoices/${draft.tenantId}/${draft.id}.pdf`, buf, {
          access: 'private',
          addRandomSuffix: false,
          contentType: 'application/pdf',
          token: blobToken,
        });
        pdfBlobUrl = result.url;
      } catch (err) {
        console.warn('[generate_booking_invoice] blob upload failed:', err);
      }
    }

    // Finalize the invoice — swap in the signed token, store the blob
    // URL, and flip status to `sent` so downstream UIs stop showing
    // "paid (pending delivery)".
    await prisma.invoice.update({
      where: { id: draft.id },
      data: {
        publicToken: token,
        pdfBlobUrl,
        pdfRenderedAt: pdfBlobUrl ? new Date() : undefined,
        status: 'sent',
      },
    });

    // Email the traveler — fire-and-forget but record the error on the
    // invoice if Resend rejects the send.
    let emailResult: { ok: boolean; id?: string; error?: string; skipped?: boolean } | null = null;
    if (notificationsConfigured() && toEmail) {
      const notifier = createNotifier();
      emailResult = await notifier.sendInvoice(toEmail, {
        invoice: props.invoice,
        publicUrl: props.publicUrl,
        pdfBuffer: buf,
      });
      if (!emailResult.ok && !emailResult.skipped) {
        await prisma.invoice.update({
          where: { id: draft.id },
          data: {
            metadata: { emailError: emailResult.error ?? 'unknown' },
          },
        });
      }
    }

    return {
      invoiceId: draft.id,
      number,
      publicUrl: props.publicUrl,
      pdfBlobUrl,
      emailResult,
      alreadyExisted: false,
    };
  },
};
