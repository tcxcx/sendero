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
  return {
    ...mapQuote(q),
    confirmedAt: q.confirmed_at,
  };
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
