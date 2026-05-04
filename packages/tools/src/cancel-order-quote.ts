/**
 * cancel_order_quote — create an UNCONFIRMED Duffel cancellation quote
 * for a flight order. Returns the refund destination (original form of
 * payment / airline credits / voucher), expiry, and any credits that
 * will be issued. Confirm with `confirm_cancel_order` within the quote
 * window to actually cancel.
 *
 * https://duffel.com/docs/guides/cancelling-an-order
 */

import { z } from 'zod';

import {
  confirmOrderCancellation,
  createOrderCancellation,
  type DuffelOrderCancellationWire,
} from '@sendero/duffel';
import { prisma } from '@sendero/database';

import type { ToolDef } from './types';

const inputSchema = z.object({
  orderId: z.string().min(3),
});

export type CancelOrderQuoteInput = z.infer<typeof inputSchema>;

export interface CancelOrderQuoteResult {
  cancellationId: string;
  orderId: string;
  refundAmount: string | null;
  refundCurrency: string | null;
  refundTo: string;
  expiresAt: string | null;
  airlineCredits: Array<{
    passengerId: string;
    creditName: string;
    creditAmount: string;
    creditCurrency: string;
  }>;
  share: {
    title: string;
    body: string;
    bullets: string[];
    primaryCta: { label: string; kind: 'confirm_cancel' };
  };
}

function mapQuote(q: DuffelOrderCancellationWire): CancelOrderQuoteResult {
  const credits = (q.airline_credits ?? []).map(c => ({
    passengerId: c.passenger_id,
    creditName: c.credit_name,
    creditAmount: c.credit_amount,
    creditCurrency: c.credit_currency,
  }));
  const bullets = [
    `Refund to: ${q.refund_to.replace(/_/g, ' ')}`,
    q.refund_amount && q.refund_currency
      ? `Refund: ${q.refund_amount} ${q.refund_currency}`
      : 'Refund amount: unknown',
    q.expires_at ? `Quote expires: ${q.expires_at.slice(0, 19).replace('T', ' ')} UTC` : '',
    ...credits.map(c => `Credit ${c.creditAmount} ${c.creditCurrency} (${c.creditName})`),
  ].filter(Boolean);
  return {
    cancellationId: q.id,
    orderId: q.order_id,
    refundAmount: q.refund_amount,
    refundCurrency: q.refund_currency,
    refundTo: q.refund_to,
    expiresAt: q.expires_at,
    airlineCredits: credits,
    share: {
      title: `Cancellation quote · ${q.refund_to.replace(/_/g, ' ')}`,
      body:
        q.refund_amount && q.refund_currency
          ? `Refund ${q.refund_amount} ${q.refund_currency} to ${q.refund_to.replace(/_/g, ' ')}.`
          : `Refund destination: ${q.refund_to.replace(/_/g, ' ')}.`,
      bullets,
      primaryCta: { label: 'Confirm cancellation', kind: 'confirm_cancel' },
    },
  };
}

export async function cancelOrderQuote(
  input: CancelOrderQuoteInput
): Promise<CancelOrderQuoteResult> {
  const q = await createOrderCancellation(input.orderId);
  return mapQuote(q);
}

export const cancelOrderQuoteTool: ToolDef<CancelOrderQuoteInput, CancelOrderQuoteResult> = {
  name: 'cancel_order_quote',
  description:
    'Create an unconfirmed Duffel cancellation quote for a flight order. Returns refund destination, refund amount (if known), and any airline credits that will be issued. Use before actually cancelling — the operator or traveler must then call `confirm_cancel_order` within the quote expiry window.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['orderId'],
    properties: { orderId: { type: 'string' } },
  },
  handler: cancelOrderQuote,
};

// ─── confirm_cancel_order ─────────────────────────────────────────────

const confirmInputSchema = z.object({
  cancellationId: z.string().min(3),
});

export type ConfirmCancelOrderInput = z.infer<typeof confirmInputSchema>;

export interface ConfirmCancelOrderResult extends CancelOrderQuoteResult {
  confirmedAt: string | null;
}

export async function confirmCancelOrder(
  input: ConfirmCancelOrderInput
): Promise<ConfirmCancelOrderResult> {
  const q = await confirmOrderCancellation(input.cancellationId);

  // Phase 5 — write 'cancelled' (and 'refunded' when applicable) events
  // to the Trip ledger. Resolve the Trip via the Booking row keyed on
  // duffelOrderId. Best-effort: cancellation has already happened on
  // Duffel's side, so the ledger write must not throw the call.
  void writeCancelEvents(q).catch(err => {
    console.warn('[confirm_cancel_order] event append failed (non-fatal)', {
      orderId: q.order_id,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  return {
    ...mapQuote(q),
    confirmedAt: q.confirmed_at,
  };
}

async function writeCancelEvents(q: DuffelOrderCancellationWire): Promise<void> {
  const booking = await prisma.booking.findFirst({
    where: { duffelOrderId: q.order_id },
    select: { id: true, tripId: true, tenantId: true, pnr: true },
  });
  if (!booking?.tripId || !booking.tenantId) return;

  const now = new Date().toISOString();
  const cancelledEvent = {
    id: `cancelled_${booking.id}_${Date.now()}`,
    kind: 'cancelled' as const,
    direction: 'internal' as const,
    channel: 'internal' as const,
    createdAt: now,
    bookingId: booking.id,
    pnr: booking.pnr,
    cancellationId: q.id,
    refundTo: q.refund_to,
    refundAmount: q.refund_amount,
    refundCurrency: q.refund_currency,
  };
  const events: object[] = [cancelledEvent];

  // 'refunded' is a separate signal — fires when there's an actual
  // refund amount on the cancellation. Operators reading the ledger
  // can distinguish "we cancelled, no refund" from "we cancelled +
  // X USD coming back" without having to inspect the cancelled event.
  if (q.refund_amount && q.refund_currency) {
    events.push({
      id: `refunded_${booking.id}_${Date.now() + 1}`,
      kind: 'refunded',
      direction: 'internal',
      channel: 'internal',
      createdAt: now,
      bookingId: booking.id,
      pnr: booking.pnr,
      refundTo: q.refund_to,
      refundAmount: q.refund_amount,
      refundCurrency: q.refund_currency,
      cancellationId: q.id,
    });
  }

  const payload = JSON.stringify(events);
  await prisma.$executeRaw`
    UPDATE "trips"
    SET events = COALESCE(events, '[]'::jsonb) || ${payload}::jsonb
    WHERE id = ${booking.tripId} AND "tenantId" = ${booking.tenantId}
  `;
}

export const confirmCancelOrderTool: ToolDef<ConfirmCancelOrderInput, ConfirmCancelOrderResult> = {
  name: 'confirm_cancel_order',
  description:
    'Confirm a Duffel cancellation quote by id (from `cancel_order_quote`). Must be called within the quote expiry. Returns the final refund + airline credit codes (credit_code is populated only after confirmation).',
  inputSchema: confirmInputSchema,
  jsonSchema: {
    type: 'object',
    required: ['cancellationId'],
    properties: { cancellationId: { type: 'string' } },
  },
  handler: confirmCancelOrder,
};
