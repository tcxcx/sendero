'use client';

/**
 * StayBookingConfirmationCard — post-booking summary per Duffel Go-Live.
 *
 * Wraps StayQuoteReviewCard with:
 *   • "Booking confirmed" banner
 *   • API-returned booking reference (verbatim, monospaced)
 *   • confirmed_at timestamp
 *
 * Every other field (billing summary, cancellation timeline, conditions,
 * key collection, business details) flows through the shared review
 * component so any post-go-live tweak lands once and renders everywhere.
 */

import {
  StayQuoteReviewCard,
  type StayQuoteReviewCardProps,
} from '@/components/ai-elements/stay-quote-card';

export interface StayBookingConfirmationCardProps {
  data: Omit<StayQuoteReviewCardProps['data'], 'quoteId'> & {
    bookingId: string;
    reference: string;
    confirmedAt: string | null;
  };
}

export function StayBookingConfirmationCard({ data }: StayBookingConfirmationCardProps) {
  return (
    <StayQuoteReviewCard
      data={{
        ...data,
        quoteId: data.bookingId,
        confirmedBannerLabel: 'Booking confirmed',
        confirmedAt: data.confirmedAt,
        bookingReference: data.reference,
      }}
    />
  );
}
