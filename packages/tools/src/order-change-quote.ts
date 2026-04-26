/**
 * Order-change tooling — propose a reschedule on a confirmed Duffel
 * order, lock in one of the priced offers, then pay + confirm.
 *
 * Three tools cover the full flow:
 *   - request_order_change         → POST /air/order_change_requests
 *   - select_order_change_offer    → POST /air/order_changes
 *   - confirm_order_change         → POST /air/order_changes/{id}/actions/confirm
 *
 * https://duffel.com/docs/guides/changing-a-flight
 */

import { z } from 'zod';

import {
  confirmOrderChange as duffelConfirmOrderChange,
  createOrderChange,
  createOrderChangeRequest,
  type DuffelOrderChangeOfferWire,
  type DuffelOrderChangeRequestWire,
  type DuffelOrderChangeSliceAdd,
  type DuffelOrderChangeSliceRemove,
  type DuffelOrderChangeWire,
} from '@sendero/duffel';

import type { ToolDef } from './types';

// ─── request_order_change ─────────────────────────────────────────────

const sliceAddSchema = z.object({
  origin: z.string().min(3),
  destination: z.string().min(3),
  departure_date: z.string().min(8),
  cabin_class: z.enum(['economy', 'premium_economy', 'business', 'first']).optional(),
});

const sliceRemoveSchema = z.object({
  slice_id: z.string().min(3),
});

const requestInputSchema = z.object({
  orderId: z.string().min(3),
  slices: z.object({
    add: z.array(sliceAddSchema),
    remove: z.array(sliceRemoveSchema),
  }),
});

export type RequestOrderChangeInput = z.infer<typeof requestInputSchema>;

export interface OrderChangeOfferSummary {
  offerId: string;
  changeAmount: string;
  changeCurrency: string;
  newTotalAmount: string;
  newTotalCurrency: string;
  penaltyAmount: string | null;
  penaltyCurrency: string | null;
  refundTo: string;
  expiresAt: string;
}

export interface RequestOrderChangeResult {
  requestId: string;
  orderId: string;
  offers: OrderChangeOfferSummary[];
  pollHint?: string;
  share: {
    title: string;
    body: string;
    bullets: string[];
    primaryCta: { label: string; kind: 'select_change_offer' };
  };
}

function mapOffer(o: DuffelOrderChangeOfferWire): OrderChangeOfferSummary {
  return {
    offerId: o.id,
    changeAmount: o.change_total_amount,
    changeCurrency: o.change_total_currency,
    newTotalAmount: o.new_total_amount,
    newTotalCurrency: o.new_total_currency,
    penaltyAmount: o.penalty_total_amount,
    penaltyCurrency: o.penalty_total_currency,
    refundTo: o.refund_to,
    expiresAt: o.expires_at,
  };
}

function mapRequest(r: DuffelOrderChangeRequestWire): RequestOrderChangeResult {
  const offers = (r.order_change_offers ?? []).map(mapOffer);
  const bullets: string[] = [];
  if (offers.length === 0) {
    bullets.push('Airline still pricing — poll the request to retrieve offers.');
  } else {
    for (const o of offers) {
      const refundTo = o.refundTo.replace(/_/g, ' ');
      const penalty =
        o.penaltyAmount && o.penaltyCurrency
          ? `${o.penaltyAmount} ${o.penaltyCurrency} penalty`
          : 'no penalty';
      bullets.push(
        `${o.changeAmount} ${o.changeCurrency} change · new total ${o.newTotalAmount} ${o.newTotalCurrency} · ${penalty} · refund to ${refundTo} · expires ${o.expiresAt.slice(0, 19).replace('T', ' ')} UTC`
      );
    }
  }
  const result: RequestOrderChangeResult = {
    requestId: r.id,
    orderId: r.order_id,
    offers,
    share: {
      title:
        offers.length === 0
          ? 'Order-change request created · pricing pending'
          : `Order-change offers · ${offers.length}`,
      body:
        offers.length === 0
          ? 'Duffel is still pricing this change. Poll the request to retrieve offers once available.'
          : `${offers.length} offer${offers.length === 1 ? '' : 's'} returned. Pick one and call select_order_change_offer.`,
      bullets,
      primaryCta: { label: 'Lock in offer', kind: 'select_change_offer' },
    },
  };
  if (offers.length === 0) {
    result.pollHint = `GET /air/order_change_requests/${r.id} to retrieve offers once airline has priced.`;
  }
  return result;
}

export async function requestOrderChange(
  input: RequestOrderChangeInput
): Promise<RequestOrderChangeResult> {
  // Zod validates required fields at runtime; the cast lets the loose
  // `strict: false` tsconfig accept the otherwise-equivalent shape.
  const r = await createOrderChangeRequest({
    orderId: input.orderId,
    slices: input.slices as {
      add: DuffelOrderChangeSliceAdd[];
      remove: DuffelOrderChangeSliceRemove[];
    },
  });
  return mapRequest(r);
}

export const requestOrderChangeTool: ToolDef<RequestOrderChangeInput, RequestOrderChangeResult> = {
  name: 'request_order_change',
  description:
    'Kick off a Duffel order-change request — propose new slices for an existing confirmed flight order. Duffel returns one or more priced offers (each with change fee + new total + refund destination). Operator picks one and calls `confirm_order_change`. Use `display_offer_conditions` first to check whether the order is changeable + see penalty estimates.',
  inputSchema: requestInputSchema,
  jsonSchema: {
    type: 'object',
    required: ['orderId', 'slices'],
    properties: {
      orderId: { type: 'string' },
      slices: {
        type: 'object',
        required: ['add', 'remove'],
        properties: {
          add: {
            type: 'array',
            items: {
              type: 'object',
              required: ['origin', 'destination', 'departure_date'],
              properties: {
                origin: { type: 'string' },
                destination: { type: 'string' },
                departure_date: { type: 'string' },
                cabin_class: {
                  type: 'string',
                  enum: ['economy', 'premium_economy', 'business', 'first'],
                },
              },
            },
          },
          remove: {
            type: 'array',
            items: {
              type: 'object',
              required: ['slice_id'],
              properties: {
                slice_id: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
  handler: requestOrderChange,
};

// ─── select_order_change_offer ────────────────────────────────────────

const selectInputSchema = z.object({
  offerId: z.string().min(3),
});

export type SelectOrderChangeOfferInput = z.infer<typeof selectInputSchema>;

export interface SelectOrderChangeOfferResult {
  changeId: string;
  orderId: string;
  changeAmount: string;
  changeCurrency: string;
  refundTo: string;
  expiresAt: string;
  confirmedAt: string | null;
}

function mapChange(c: DuffelOrderChangeWire): SelectOrderChangeOfferResult {
  return {
    changeId: c.id,
    orderId: c.order_id,
    changeAmount: c.change_total_amount,
    changeCurrency: c.change_total_currency,
    refundTo: c.refund_to,
    expiresAt: c.expires_at,
    confirmedAt: c.confirmed_at,
  };
}

export async function selectOrderChangeOffer(
  input: SelectOrderChangeOfferInput
): Promise<SelectOrderChangeOfferResult> {
  const c = await createOrderChange(input.offerId);
  return mapChange(c);
}

export const selectOrderChangeOfferTool: ToolDef<
  SelectOrderChangeOfferInput,
  SelectOrderChangeOfferResult
> = {
  name: 'select_order_change_offer',
  description:
    'Lock in one of the offers returned by `request_order_change` (creates an unconfirmed `order_change`). Operator must call `confirm_order_change` within `expiresAt`. No money moves yet.',
  inputSchema: selectInputSchema,
  jsonSchema: {
    type: 'object',
    required: ['offerId'],
    properties: { offerId: { type: 'string' } },
  },
  handler: selectOrderChangeOffer,
};

// ─── confirm_order_change ─────────────────────────────────────────────

const confirmInputSchema = z.object({
  changeId: z.string().min(3),
  payment: z.object({
    type: z.enum(['balance', 'arc', 'card']),
    amount: z.string().min(1),
    currency: z.string().min(3),
  }),
});

export type ConfirmOrderChangeInput = z.infer<typeof confirmInputSchema>;

export type ConfirmOrderChangeResult = SelectOrderChangeOfferResult;

export async function confirmOrderChange(
  input: ConfirmOrderChangeInput
): Promise<ConfirmOrderChangeResult> {
  const c = await duffelConfirmOrderChange({
    changeId: input.changeId,
    payment: input.payment as {
      type: 'balance' | 'arc' | 'card';
      amount: string;
      currency: string;
    },
  });
  return mapChange(c);
}

export const confirmOrderChangeTool: ToolDef<ConfirmOrderChangeInput, ConfirmOrderChangeResult> = {
  name: 'confirm_order_change',
  description:
    'Pay + confirm a Duffel `order_change` (id from `select_order_change_offer`). Returns the final change with `confirmedAt`. Once confirmed, the airline reissues the ticket and any refund is sent to `refundTo`.',
  inputSchema: confirmInputSchema,
  jsonSchema: {
    type: 'object',
    required: ['changeId', 'payment'],
    properties: {
      changeId: { type: 'string' },
      payment: {
        type: 'object',
        required: ['type', 'amount', 'currency'],
        properties: {
          type: { type: 'string', enum: ['balance', 'arc', 'card'] },
          amount: { type: 'string' },
          currency: { type: 'string' },
        },
      },
    },
  },
  handler: confirmOrderChange,
};
