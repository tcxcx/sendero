/**
 * book_stay — complete a Duffel Stays booking from a confirmed quote.
 * Supports loyalty programme accounts, special requests, and Duffel
 * CustomerUser linkage (unlocks Travel Support Assistant on the stay).
 *
 * https://duffel.com/docs/guides/booking-with-loyalty
 */

import { z } from 'zod';

import { createStayBooking } from '@sendero/duffel';
import type {
  DuffelCustomerUserId,
  DuffelStaysBookingPayloadWire,
  DuffelStaysCancellationTimelineEntryWire,
} from '@sendero/duffel';

import { ensureFlightCustomer } from './ensure-flight-customer';
import type { ToolContext, ToolDef } from './types';

const guestSchema = z.object({
  givenName: z.string().min(1),
  familyName: z.string().min(1),
  bornOn: z.string().optional(),
  customerUserId: z.string().optional(),
});

const inputSchema = z.object({
  quoteId: z.string().min(3),
  email: z.string().email(),
  phoneNumber: z.string().optional(),
  guests: z.array(guestSchema).min(1).max(9),
  loyaltyProgrammeAccountNumber: z.string().optional(),
  accommodationSpecialRequests: z.string().max(1000).optional(),
  additionalCustomerUserIds: z.array(z.string().min(3)).optional(),
});

export type BookStayInput = z.infer<typeof inputSchema>;

export interface BookStayResult {
  bookingId: string;
  reference: string;
  status: string;
  totalAmount: string;
  totalCurrency: string;
  checkInDate: string;
  checkOutDate: string;
  accommodationName?: string;
  customerUserIds: string[];
  cancellationTimeline: DuffelStaysCancellationTimelineEntryWire[];
  share: {
    title: string;
    body: string;
    bullets: string[];
  };
}

export async function bookStay(input: BookStayInput, ctx?: ToolContext): Promise<BookStayResult> {
  const customerUserIds: DuffelCustomerUserId[] = [];
  if (ctx?.traveler?.userId) {
    try {
      const identity = await ensureFlightCustomer(
        { clerkUserId: ctx.traveler.userId, tenantId: ctx.traveler.tenantId },
        ctx
      );
      customerUserIds.push(identity.supplierTravelerId as DuffelCustomerUserId);
    } catch {
      // best effort; continue without link
    }
  }
  for (const id of input.additionalCustomerUserIds ?? []) {
    if (id && !customerUserIds.includes(id as DuffelCustomerUserId)) {
      customerUserIds.push(id as DuffelCustomerUserId);
    }
  }

  const primaryCustomerUserId = customerUserIds[0];
  const payload: DuffelStaysBookingPayloadWire = {
    quote_id: input.quoteId as DuffelStaysBookingPayloadWire['quote_id'],
    email: input.email,
    phone_number: input.phoneNumber,
    guests: input.guests.map((g, i) => ({
      given_name: g.givenName,
      family_name: g.familyName,
      born_on: g.bornOn,
      user_id:
        (g.customerUserId as DuffelCustomerUserId | undefined) ??
        (i === 0 ? primaryCustomerUserId : undefined),
    })),
    loyalty_programme_account_number: input.loyaltyProgrammeAccountNumber,
    accommodation_special_requests: input.accommodationSpecialRequests,
    users: customerUserIds.length ? customerUserIds : undefined,
  };

  const booking = await createStayBooking(payload);

  const bullets = [
    `Ref ${booking.reference} · ${booking.status}`,
    `${booking.check_in_date} → ${booking.check_out_date}`,
    booking.accommodation?.name ?? '',
    `${booking.total_amount} ${booking.total_currency}`,
    input.loyaltyProgrammeAccountNumber
      ? `Loyalty account: ${input.loyaltyProgrammeAccountNumber}`
      : '',
  ].filter(Boolean);

  return {
    bookingId: booking.id,
    reference: booking.reference,
    status: booking.status,
    totalAmount: booking.total_amount,
    totalCurrency: booking.total_currency,
    checkInDate: booking.check_in_date,
    checkOutDate: booking.check_out_date,
    accommodationName: booking.accommodation?.name,
    customerUserIds,
    cancellationTimeline: booking.cancellation_timeline ?? [],
    share: {
      title: `Stay booked · ${booking.reference}`,
      body: booking.accommodation?.name
        ? `${booking.accommodation.name} · ${booking.check_in_date} → ${booking.check_out_date}`
        : `${booking.check_in_date} → ${booking.check_out_date}`,
      bullets,
    },
  };
}

export const bookStayTool: ToolDef<BookStayInput, BookStayResult> = {
  name: 'book_stay',
  description:
    'Complete a Duffel Stays booking from a confirmed quoteId. Supports loyalty programme account numbers, special requests, and Customer User linkage (unlocks Travel Support Assistant for the guest). The session traveler is auto-linked via ensure_flight_customer.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['quoteId', 'email', 'guests'],
    properties: {
      quoteId: { type: 'string' },
      email: { type: 'string', format: 'email' },
      phoneNumber: { type: 'string' },
      guests: {
        type: 'array',
        minItems: 1,
        maxItems: 9,
        items: {
          type: 'object',
          required: ['givenName', 'familyName'],
          properties: {
            givenName: { type: 'string' },
            familyName: { type: 'string' },
            bornOn: { type: 'string', description: 'ISO date' },
            customerUserId: { type: 'string' },
          },
        },
      },
      loyaltyProgrammeAccountNumber: { type: 'string' },
      accommodationSpecialRequests: { type: 'string', maxLength: 1000 },
      additionalCustomerUserIds: {
        type: 'array',
        items: { type: 'string' },
      },
    },
  },
  handler: bookStay,
};
