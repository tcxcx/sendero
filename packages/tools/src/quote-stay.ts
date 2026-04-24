/**
 * quote_stay — create a Duffel Stays quote from a rate id. Surfaces
 * the cancellation timeline, payment type (pay_now | deposit |
 * guarantee), supported loyalty programme, and all rate conditions so
 * the traveler / operator can confirm before booking.
 *
 * https://duffel.com/docs/guides/booking-with-loyalty
 * https://duffel.com/docs/guides/displaying-the-cancellation-timeline
 */

import { z } from 'zod';

import { createStayQuote } from '@sendero/duffel';
import type {
  DuffelStaysCancellationTimelineEntryWire,
  DuffelStaysPaymentType,
  DuffelStaysRateConditionWire,
  DuffelStaysSupportedLoyaltyProgrammeWire,
} from '@sendero/duffel';

import type { ToolDef } from './types';

const inputSchema = z.object({
  rateId: z.string().min(3),
});

export type QuoteStayInput = z.infer<typeof inputSchema>;

export interface QuoteStayResult {
  quoteId: string;
  totalAmount: string;
  totalCurrency: string;
  dueAtAccommodationAmount?: string;
  dueAtAccommodationCurrency?: string;
  checkInDate: string;
  checkOutDate: string;
  paymentType?: DuffelStaysPaymentType;
  cancellationTimeline: DuffelStaysCancellationTimelineEntryWire[];
  supportedLoyaltyProgramme: DuffelStaysSupportedLoyaltyProgrammeWire | null;
  conditions: DuffelStaysRateConditionWire[];
  share: {
    title: string;
    body: string;
    bullets: string[];
  };
}

function summarizeTimeline(
  timeline: DuffelStaysCancellationTimelineEntryWire[],
  totalAmount: string
): string[] {
  if (!timeline.length) return ['Non-refundable — no refund after booking.'];
  const lines: string[] = [];
  for (const t of timeline) {
    const isFull = Number(t.refund_amount) === Number(totalAmount);
    const label = isFull ? 'Fully refundable' : 'Partial refund';
    lines.push(`${label} until ${t.before.slice(0, 10)} — ${t.refund_amount} ${t.currency}`);
  }
  const last = timeline[timeline.length - 1];
  lines.push(`No refund after ${last.before.slice(0, 10)}`);
  return lines;
}

export async function quoteStay(input: QuoteStayInput): Promise<QuoteStayResult> {
  const q = await createStayQuote(input.rateId);
  const timeline = q.cancellation_timeline ?? [];
  const bullets = [
    `Total ${q.total_amount} ${q.total_currency}${q.payment_type ? ` · ${q.payment_type}` : ''}`,
    `${q.check_in_date} → ${q.check_out_date}`,
    ...summarizeTimeline(timeline, q.total_amount),
    q.supported_loyalty_programme
      ? `Loyalty: ${q.supported_loyalty_programme.name ?? q.supported_loyalty_programme.reference}`
      : '',
    ...(q.conditions ?? []).map(c => c.title + (c.description ? ` — ${c.description}` : '')),
  ].filter(Boolean);
  return {
    quoteId: q.id,
    totalAmount: q.total_amount,
    totalCurrency: q.total_currency,
    dueAtAccommodationAmount: q.due_at_accommodation_amount ?? undefined,
    dueAtAccommodationCurrency: q.due_at_accommodation_currency ?? undefined,
    checkInDate: q.check_in_date,
    checkOutDate: q.check_out_date,
    paymentType: q.payment_type,
    cancellationTimeline: timeline,
    supportedLoyaltyProgramme: q.supported_loyalty_programme ?? null,
    conditions: q.conditions ?? [],
    share: {
      title: `Quote ${q.total_amount} ${q.total_currency}`,
      body: `${q.check_in_date} → ${q.check_out_date}${q.payment_type ? ` · ${q.payment_type}` : ''}`,
      bullets,
    },
  };
}

export const quoteStayTool: ToolDef<QuoteStayInput, QuoteStayResult> = {
  name: 'quote_stay',
  description:
    'Convert a Duffel Stays rate into a confirmed quote. Returns the cancellation timeline, payment type (pay_now / deposit / guarantee), supported loyalty programme, and rate conditions. Hand the `quoteId` to `book_stay` to complete the booking.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['rateId'],
    properties: { rateId: { type: 'string' } },
  },
  handler: quoteStay,
};
