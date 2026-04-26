/**
 * Phase-11b Epic 8 — fires after settle_booking in the workflow.
 *
 * Finds the Booking (matched via externalId on the hex32 escrow
 * bookingId), increments the per-tenant/year InvoiceSequence,
 * atomically creates the Invoice + LineItem(s) + Payment rows, signs
 * the public JWT token, renders the PDF to Vercel Blob, then emails
 * the traveler a copy with the PDF attached.
 *
 * Idempotent on Booking.id — if an Invoice already exists for this
 * booking (Invoice.bookingId is @unique), the existing row is returned
 * without re-rendering or re-sending.
 *
 * ─── Track C1 — itemized vs single-line invoice rendering ─────────────
 *
 * Two modes, driven by `Booking.metadata.invoiceItemization` (frozen at
 * confirm time per Eng A3 — see `confirm-booking.ts` + `booking-metadata.ts`):
 *
 *   - `single`   → ONE InvoiceLineItem at the customer-facing total.
 *                  `sourceKind = 'booking'`. What consumers expect.
 *   - `itemized` → TWO or THREE lines. Always: supplier cost
 *                  (`booking_cost`) + agency markup (`booking_markup`).
 *                  Plus a Sendero service fee line (`booking_sendero_fee`)
 *                  ONLY when the policy snapshot says
 *                  `senderoTakeBehavior === 'add_to_customer'`. In
 *                  `deduct_from_markup` mode the customer NEVER sees the
 *                  Sendero fee — it comes out of the tenant's markup.
 *
 * Backwards compat: legacy bookings with `costMicroUsdc === null`
 * (pre-markup-v1 rows that haven't been backfilled) keep the original
 * single-line behavior reading `Booking.totalUsd`. The customer-facing
 * total is identical to what they paid; no UX regression.
 *
 * Invariants:
 *   - `Invoice.subtotalMicro === Invoice.totalMicro === SUM(lineItems.amountMicro)`.
 *     The renderer relies on this; downstream reconciliation does too.
 *   - Idempotency: `Invoice.bookingId @unique` means only ONE invoice can
 *     exist per booking. Re-running is a no-op.
 */

import { prisma } from '@sendero/database';
import { BookingPolicySnapshotSchema, type BookingPolicySnapshot } from '@sendero/billing/markup';
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
import {
  defaultItemizationForSegment,
  readBookingSegment,
  readInvoiceItemization,
  type InvoiceItemization,
} from './booking-metadata';

const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'hex32 (0x + 64 hex chars)');

const generateBookingInvoiceInput = z.object({
  bookingId: hex32,
  settleTxHash: z.string().optional(),
});

// ─── Line item assembly (Track C1) ────────────────────────────────────

interface LineItemDraft {
  position: number;
  description: string;
  quantity: number;
  unitPriceMicro: bigint;
  amountMicro: bigint;
  sourceKind: string;
  sourceRef: string | null;
}

interface BookingForLines {
  id: string;
  kind: string;
  pnr: string | null;
  totalUsd: { toString(): string };
  costMicroUsdc: bigint | null;
  markupMicroUsdc: bigint | null;
  senderoTakeMicroUsdc: bigint | null;
  metadata: Record<string, unknown> | null;
}

interface LineItemPlan {
  /** Line item drafts, in invoice order. */
  lineItems: LineItemDraft[];
  /** Sum of all line items — also written to Invoice.{subtotalMicro,totalMicro}. */
  totalMicro: bigint;
  /** Mode actually applied (after legacy/snapshot resolution). */
  modeUsed: InvoiceItemization | 'legacy';
}

/**
 * Build the cost-line description. Surfaces the supplier kind +
 * optional PNR, mirroring the existing single-line copy so legacy
 * invoices and itemized invoices read the same.
 *
 * Future: when we have richer Booking detail columns (supplier name,
 * dates, nights), expand this to "3 nights at Marriott Downtown ·
 * Mar 14–17". For now, kind + PNR.
 */
function describeCostLine(booking: BookingForLines): string {
  const pnrSuffix = booking.pnr ? ` · PNR ${booking.pnr}` : '';
  return `Trip · ${booking.kind}${pnrSuffix}`;
}

/**
 * Resolve the customer-facing total + a 1- or 3-line breakdown from a
 * v1 booking (cost + markup + take). Pure — no IO.
 *
 * Caller has already confirmed `costMicroUsdc != null` (we're on the
 * v1 path).
 */
function planLineItemsV1(args: {
  booking: BookingForLines;
  costMicro: bigint;
  markupMicro: bigint;
  senderoTakeMicro: bigint;
  itemization: InvoiceItemization;
  senderoTakeBehavior: BookingPolicySnapshot['senderoTakeBehavior'] | null;
}): LineItemPlan {
  // Customer total math:
  //   add_to_customer  → cost + markup + sendero_take (customer sees three)
  //   deduct_from_markup → cost + markup            (customer sees two; tenant absorbs)
  // When the snapshot is missing (defensive), assume `add_to_customer`
  // — that matches the conservative read where the take could have
  // been collected from the customer.
  const showSenderoFee =
    args.senderoTakeBehavior === 'add_to_customer' ||
    (args.senderoTakeBehavior == null && args.senderoTakeMicro > 0n);

  const customerTotalMicro = showSenderoFee
    ? args.costMicro + args.markupMicro + args.senderoTakeMicro
    : args.costMicro + args.markupMicro;

  if (args.itemization === 'single') {
    return {
      lineItems: [
        {
          position: 1,
          description: describeCostLine(args.booking),
          quantity: 1,
          unitPriceMicro: customerTotalMicro,
          amountMicro: customerTotalMicro,
          sourceKind: 'booking',
          sourceRef: args.booking.id,
        },
      ],
      totalMicro: customerTotalMicro,
      modeUsed: 'single',
    };
  }

  // Itemized: 2 or 3 lines. Cost first, then agency markup, then
  // (only in add_to_customer mode) the Sendero service fee.
  const lines: LineItemDraft[] = [
    {
      position: 1,
      description: describeCostLine(args.booking),
      quantity: 1,
      unitPriceMicro: args.costMicro,
      amountMicro: args.costMicro,
      sourceKind: 'booking_cost',
      sourceRef: args.booking.id,
    },
    {
      position: 2,
      description: 'Booking management fee',
      quantity: 1,
      unitPriceMicro: args.markupMicro,
      amountMicro: args.markupMicro,
      sourceKind: 'booking_markup',
      sourceRef: args.booking.id,
    },
  ];

  if (showSenderoFee) {
    lines.push({
      position: 3,
      description: 'Service fee',
      quantity: 1,
      unitPriceMicro: args.senderoTakeMicro,
      amountMicro: args.senderoTakeMicro,
      sourceKind: 'booking_sendero_fee',
      sourceRef: args.booking.id,
    });
  }

  return {
    lineItems: lines,
    totalMicro: customerTotalMicro,
    modeUsed: 'itemized',
  };
}

/**
 * Legacy fallback for bookings that pre-date markup v1 (no
 * costMicroUsdc). One line at totalUsd, exactly as before.
 */
function planLineItemsLegacy(booking: BookingForLines): LineItemPlan {
  const totalMicro = decimalToMicro(booking.totalUsd.toString());
  return {
    lineItems: [
      {
        position: 1,
        description: describeCostLine(booking),
        quantity: 1,
        unitPriceMicro: totalMicro,
        amountMicro: totalMicro,
        sourceKind: 'booking',
        sourceRef: booking.id,
      },
    ],
    totalMicro,
    modeUsed: 'legacy',
  };
}

/**
 * Top-level dispatch. Reads cost/markup/take + snapshot off the
 * booking, picks the itemization mode, and returns the plan. Exposed
 * for unit tests so the line-item assembly can be exercised without
 * Prisma.
 */
export function planInvoiceLineItems(args: {
  booking: BookingForLines;
  /** Override the per-booking itemization (test seam / agent hint). */
  itemizationHint?: InvoiceItemization;
}): LineItemPlan {
  const { booking } = args;

  // Legacy guard: pre-v1 row → single line at totalUsd, sourceKind 'booking'.
  if (booking.costMicroUsdc == null) {
    return planLineItemsLegacy(booking);
  }

  // Resolve the policy snapshot. Stored as JSON on Booking.metadata at
  // confirm time. We tolerate a missing/malformed snapshot and fall back
  // to a defensive `add_to_customer` interpretation (worst case the
  // customer sees the take broken out — never the inverse).
  const snapshot = parsePolicySnapshot(booking.metadata);

  // Resolve the itemization mode. Order:
  //   1. Caller hint (e.g. agent override at invoice time).
  //   2. `Booking.metadata.invoiceItemization` (frozen at confirm).
  //   3. `Booking.metadata.segment` → segment-default.
  //   4. Hard default: 'single'.
  const itemization: InvoiceItemization =
    args.itemizationHint ??
    readInvoiceItemization(booking.metadata) ??
    defaultItemizationForSegment(readBookingSegment(booking.metadata));

  return planLineItemsV1({
    booking,
    costMicro: booking.costMicroUsdc,
    markupMicro: booking.markupMicroUsdc ?? 0n,
    senderoTakeMicro: booking.senderoTakeMicroUsdc ?? 0n,
    itemization,
    senderoTakeBehavior: snapshot?.senderoTakeBehavior ?? null,
  });
}

/**
 * Pull the `policySnapshot` out of `Booking.metadata` and validate it
 * via the canonical Zod schema. Returns null on missing OR malformed
 * data — the caller falls back to a defensive `add_to_customer`
 * read in either case. We never throw on invoice generation because of
 * a stale snapshot.
 */
function parsePolicySnapshot(
  metadata: Record<string, unknown> | null | undefined
): BookingPolicySnapshot | null {
  const raw = metadata?.policySnapshot;
  if (!raw || typeof raw !== 'object') return null;
  const parsed = BookingPolicySnapshotSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export const generateBookingInvoiceTool: ToolDef = {
  name: 'generate_booking_invoice',
  description:
    'Issue a booking invoice after settle_booking. Creates Invoice + LineItem(s) + Payment rows, ' +
    'renders PDF to Vercel Blob, signs public token, emails the traveler. Itemized vs single-line ' +
    'driven by Booking.metadata.invoiceItemization (frozen at confirm time). Idempotent on the ' +
    'booking (unique FK).',
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

    // Plan the line items. Honors Booking.metadata.invoiceItemization
    // (frozen at confirm time) and respects senderoTakeBehavior so we
    // never surface the Sendero fee on the customer invoice when the
    // tenant absorbs it.
    const plan = planInvoiceLineItems({
      booking: {
        id: booking.id,
        kind: booking.kind,
        pnr: booking.pnr,
        totalUsd: booking.totalUsd,
        costMicroUsdc: booking.costMicroUsdc,
        markupMicroUsdc: booking.markupMicroUsdc,
        senderoTakeMicroUsdc: booking.senderoTakeMicroUsdc,
        metadata: (booking.metadata as Record<string, unknown> | null) ?? null,
      },
    });
    const totalMicro = plan.totalMicro;

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
        // Persist the invoice mode on the row's metadata for downstream
        // renderers / observability. The line-item shape is canonical;
        // this field is a convenience read.
        metadata: { invoiceItemization: plan.modeUsed } as object,
        lineItems: {
          create: plan.lineItems.map(li => ({
            position: li.position,
            description: li.description,
            quantity: li.quantity,
            unitPriceMicro: li.unitPriceMicro,
            amountMicro: li.amountMicro,
            sourceKind: li.sourceKind,
            sourceRef: li.sourceRef ?? undefined,
          })),
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
      itemization: plan.modeUsed,
    };
  },
};
