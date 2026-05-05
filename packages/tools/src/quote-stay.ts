/**
 * quote_stay — confirm a Duffel Stays rate before booking. Surfaces every
 * field Duffel's Go-Live review demands: guests + rooms + nights, the
 * accommodation name + address, check-in/out dates AND times, the full
 * billing breakdown (base + taxes + fees + total + due-at-property — all
 * separated, per the API), the verbatim cancellation timeline, every rate
 * condition (visible by default, no expand action), key collection
 * instructions (always shown, even when null), and Sendero's business
 * details footer.
 *
 * Returns both:
 *   - `share` — the cross-channel summary every renderer reads.
 *   - `stayQuoteReview` — a typed payload the channel-render layer
 *     extracts to paint the dedicated review card. See
 *     `apps/app/lib/channel-render/types.ts::ChannelMessageStayQuoteReview`.
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
  DuffelStaysQuoteWire,
} from '@sendero/duffel';

import { senderoBusinessDetails, type SenderoBusinessDetails } from './lib/sendero-business';
import type { ToolDef } from './types';

const inputSchema = z.object({
  rateId: z.string().min(3),
});

export type QuoteStayInput = z.infer<typeof inputSchema>;

export interface StayQuoteAccommodationView {
  name: string;
  country: string | null;
  city: string | null;
  /** Joined one-liner: `line_one, region postal_code`. */
  address: string | null;
  /** "14:30" / "11:30". */
  checkInAfter: string | null;
  checkOutBefore: string | null;
  /** Always present in the payload — falls back to the Duffel-recommended
   *  "Ask at the property" copy when the API field is null. */
  keyCollection: string | null;
}

export interface StayQuoteBillingView {
  baseAmount: string | null;
  baseCurrency: string | null;
  taxAmount: string;
  taxCurrency: string;
  feeAmount: string;
  feeCurrency: string;
  totalAmount: string;
  totalCurrency: string;
  /** Always set; "0" when API returns null. */
  dueAtAccommodationAmount: string;
  dueAtAccommodationCurrency: string;
}

export interface StayQuoteCancellationView {
  before: string;
  refundAmount: string;
  currency: string;
}

export interface StayQuoteConditionView {
  title: string;
  /** Verbatim from the API. Renderers MUST NOT truncate. */
  description: string;
}

/** Structured payload the channel-render extractor matches on. */
export interface StayQuoteReviewPayload {
  quoteId: string;
  accommodation: StayQuoteAccommodationView;
  checkInDate: string;
  checkOutDate: string;
  nights: number;
  rooms: number;
  guests: number;
  roomName: string | null;
  paymentType: DuffelStaysPaymentType | null;
  billing: StayQuoteBillingView;
  cancellationTimeline: StayQuoteCancellationView[];
  conditions: StayQuoteConditionView[];
  supportedLoyaltyProgrammeName?: string | null;
  business: SenderoBusinessDetails;
}

export interface QuoteStayResult {
  // Top-level legacy fields kept stable for callers reading the raw return.
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
  /** Duffel-mandated structured payload — operator + channel renderers extract. */
  stayQuoteReview: StayQuoteReviewPayload;
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

function nightsBetween(checkIn: string, checkOut: string): number {
  // Both ISO YYYY-MM-DD; treat as UTC midnights so DST never shifts the count.
  const a = Date.parse(`${checkIn}T00:00:00Z`);
  const b = Date.parse(`${checkOut}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

function joinAddress(
  loc: DuffelStaysQuoteWire['accommodation'] extends infer T
    ? T extends { location?: infer L }
      ? L
      : never
    : never
): string | null {
  if (!loc || typeof loc !== 'object') return null;
  const addr = (loc as { address?: Record<string, string | null | undefined> }).address;
  if (!addr) return null;
  const parts = [
    addr.line_one,
    addr.region,
    addr.city_name,
    addr.postal_code,
    addr.country_code,
  ].filter((s): s is string => typeof s === 'string' && s.length > 0);
  return parts.length ? parts.join(', ') : null;
}

/**
 * Build the structured pre-booking payload. Pure (no IO) so the operator
 * surface, channel renderers, and the post-booking email template can
 * reuse it without re-deriving fields off raw Duffel JSON.
 */
export function buildStayQuoteReview(
  q: DuffelStaysQuoteWire,
  business: SenderoBusinessDetails
): StayQuoteReviewPayload {
  const acc = q.accommodation;
  const room = acc?.rooms?.[0];
  const rate = room?.rates?.[0];

  const totalCurrency = q.total_currency;
  const billing: StayQuoteBillingView = {
    baseAmount: q.base_amount ?? rate?.base_amount ?? null,
    baseCurrency: q.base_currency ?? rate?.base_currency ?? totalCurrency,
    taxAmount: q.tax_amount ?? rate?.tax_amount ?? '0',
    taxCurrency: q.tax_currency ?? rate?.tax_currency ?? totalCurrency,
    feeAmount: q.fee_amount ?? rate?.fee_amount ?? '0',
    feeCurrency: q.fee_currency ?? rate?.fee_currency ?? totalCurrency,
    totalAmount: q.total_amount,
    totalCurrency,
    dueAtAccommodationAmount: q.due_at_accommodation_amount ?? '0',
    dueAtAccommodationCurrency: q.due_at_accommodation_currency ?? totalCurrency,
  };

  const accommodation: StayQuoteAccommodationView = {
    name: acc?.name ?? 'Property',
    country: acc?.location?.address?.country_code ?? null,
    city: acc?.location?.address?.city_name ?? null,
    address: joinAddress(acc?.location ?? null),
    checkInAfter: acc?.check_in_information?.check_in_after_time ?? null,
    checkOutBefore: acc?.check_in_information?.check_out_before_time ?? null,
    // Duffel guidance: surface even when null with a fallback note so the
    // user knows what to do at arrival.
    keyCollection: acc?.key_collection?.instructions ?? null,
  };

  const cancellationTimeline: StayQuoteCancellationView[] = (q.cancellation_timeline ?? []).map(
    t => ({
      before: t.before,
      refundAmount: t.refund_amount,
      currency: t.currency,
    })
  );

  const conditions: StayQuoteConditionView[] = (q.conditions ?? []).map(c => ({
    title: c.title,
    description: c.description ?? '',
  }));

  const guestsCount = Array.isArray(q.guests) ? q.guests.length : 0;

  return {
    quoteId: q.id,
    accommodation,
    checkInDate: q.check_in_date,
    checkOutDate: q.check_out_date,
    nights: nightsBetween(q.check_in_date, q.check_out_date),
    rooms: (q.rooms ?? room) ? 1 : 0,
    guests: guestsCount,
    roomName: room?.name ?? null,
    paymentType: q.payment_type ?? null,
    billing,
    cancellationTimeline,
    conditions,
    supportedLoyaltyProgrammeName:
      q.supported_loyalty_programme?.name ?? q.supported_loyalty_programme?.reference ?? null,
    business,
  };
}

export async function quoteStay(input: QuoteStayInput): Promise<QuoteStayResult> {
  const q = await createStayQuote(input.rateId);
  const review = buildStayQuoteReview(q, senderoBusinessDetails());
  const timeline = q.cancellation_timeline ?? [];

  const bullets = [
    `${review.nights} nights · ${review.rooms} room${review.rooms === 1 ? '' : 's'} · ${review.guests} guest${review.guests === 1 ? '' : 's'}`,
    `${review.accommodation.name}${review.accommodation.city ? ` · ${review.accommodation.city}` : ''}`,
    `Check-in ${review.checkInDate}${review.accommodation.checkInAfter ? ` after ${review.accommodation.checkInAfter}` : ''}`,
    `Check-out ${review.checkOutDate}${review.accommodation.checkOutBefore ? ` before ${review.accommodation.checkOutBefore}` : ''}`,
    `Total ${review.billing.totalAmount} ${review.billing.totalCurrency} (tax ${review.billing.taxAmount} · fee ${review.billing.feeAmount}${review.billing.dueAtAccommodationAmount !== '0' ? ` · due at property ${review.billing.dueAtAccommodationAmount} ${review.billing.dueAtAccommodationCurrency}` : ''})`,
    ...summarizeTimeline(timeline, q.total_amount),
    review.supportedLoyaltyProgrammeName ? `Loyalty: ${review.supportedLoyaltyProgrammeName}` : '',
    ...review.conditions.map(c => c.title),
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
    stayQuoteReview: review,
    share: {
      title: `Quote ${review.billing.totalAmount} ${review.billing.totalCurrency}`,
      body: `${review.accommodation.name} · ${review.checkInDate} → ${review.checkOutDate}${review.paymentType ? ` · ${review.paymentType}` : ''}`,
      bullets,
    },
  };
}

export const quoteStayTool: ToolDef<QuoteStayInput, QuoteStayResult> = {
  name: 'quote_stay',
  description:
    'Convert a Duffel Stays rate into a confirmed quote. Returns the full pre-booking review payload (guests/rooms/nights, accommodation, billing breakdown with separated tax/fee/due-at-property, cancellation timeline verbatim, rate conditions verbatim, key collection instructions). Hand the `quoteId` to `book_stay` to commit.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['rateId'],
    properties: { rateId: { type: 'string' } },
  },
  handler: quoteStay,
};
