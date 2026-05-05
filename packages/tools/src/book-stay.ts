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
  DuffelStaysBookingWire,
  DuffelStaysCancellationTimelineEntryWire,
} from '@sendero/duffel';
import type { MeterPayerType } from '@sendero/database';

import { ensureFlightCustomer } from './ensure-flight-customer';
import { resolvePayer, PayerResolutionError } from './lib/resolve-payer';
import { payerCopy } from './lib/payer-copy';
import { senderoBusinessDetails, type SenderoBusinessDetails } from './lib/sendero-business';
import { buildTripBriefShareUrl } from './lib/trip-brief-token';
import type {
  StayQuoteAccommodationView,
  StayQuoteBillingView,
  StayQuoteCancellationView,
  StayQuoteConditionView,
} from './quote-stay';
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
  /// Override the trip-resolved payer for this booking. `tenant` debits
  /// the tenant treasury at confirm time; `traveler` debits the traveler
  /// wallet. Falls back to `Trip.paymentMode` → `Tenant.defaultPaymentMode`.
  /// See `packages/tools/src/lib/resolve-payer.ts`.
  provisionedBy: z.enum(['tenant', 'traveler']).optional(),
  /// Optional Trip.id for payer resolution. When omitted we fall through
  /// to the tenant default; passing the trip pins the resolution.
  tripId: z.string().optional(),
});

export type BookStayInput = z.infer<typeof inputSchema>;

export interface StayBookingConfirmationPayload {
  bookingId: string;
  /** Duffel-returned booking reference. Renderers MUST surface verbatim. */
  reference: string;
  status: string;
  /** ISO timestamp from Duffel (`confirmed_at`). May be null on async bookings. */
  confirmedAt: string | null;
  accommodation: StayQuoteAccommodationView;
  checkInDate: string;
  checkOutDate: string;
  nights: number;
  rooms: number;
  guests: number;
  roomName: string | null;
  payer?: MeterPayerType | null;
  billing: StayQuoteBillingView;
  cancellationTimeline: StayQuoteCancellationView[];
  conditions: StayQuoteConditionView[];
  supportedLoyaltyProgrammeName?: string | null;
  business: SenderoBusinessDetails;
}

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
  /// Resolved payer for this booking (`tenant` or `traveler`). Echoed
  /// from `resolvePayer` so downstream `confirm_booking` + renderer copy
  /// stay consistent without re-resolving.
  provisionedBy?: MeterPayerType;
  /** Duffel-mandated structured payload — operator + channel renderers extract. */
  stayBookingConfirmation: StayBookingConfirmationPayload;
  share: {
    title: string;
    body: string;
    bullets: string[];
  };
}

function nightsBetween(checkIn: string, checkOut: string): number {
  const a = Date.parse(`${checkIn}T00:00:00Z`);
  const b = Date.parse(`${checkOut}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

function joinAddress(loc: unknown): string | null {
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

function buildBookingConfirmation(
  b: DuffelStaysBookingWire,
  payer: MeterPayerType | undefined,
  business: SenderoBusinessDetails
): StayBookingConfirmationPayload {
  const acc = b.accommodation;
  const room = acc?.rooms?.[0];
  const rate = room?.rates?.[0];
  const totalCurrency = b.total_currency;
  const billing: StayQuoteBillingView = {
    baseAmount: b.base_amount ?? rate?.base_amount ?? null,
    baseCurrency: b.base_currency ?? rate?.base_currency ?? totalCurrency,
    taxAmount: b.tax_amount ?? rate?.tax_amount ?? '0',
    taxCurrency: b.tax_currency ?? rate?.tax_currency ?? totalCurrency,
    feeAmount: b.fee_amount ?? rate?.fee_amount ?? '0',
    feeCurrency: b.fee_currency ?? rate?.fee_currency ?? totalCurrency,
    totalAmount: b.total_amount,
    totalCurrency,
    dueAtAccommodationAmount: b.due_at_accommodation_amount ?? '0',
    dueAtAccommodationCurrency: b.due_at_accommodation_currency ?? totalCurrency,
  };
  const accommodation: StayQuoteAccommodationView = {
    name: acc?.name ?? 'Property',
    country: acc?.location?.address?.country_code ?? null,
    city: acc?.location?.address?.city_name ?? null,
    address: joinAddress(acc?.location ?? null),
    checkInAfter: acc?.check_in_information?.check_in_after_time ?? null,
    checkOutBefore: acc?.check_in_information?.check_out_before_time ?? null,
    keyCollection: acc?.key_collection?.instructions ?? null,
  };
  const cancellationTimeline: StayQuoteCancellationView[] = (b.cancellation_timeline ?? []).map(
    t => ({ before: t.before, refundAmount: t.refund_amount, currency: t.currency })
  );
  const conditions: StayQuoteConditionView[] = (b.conditions ?? []).map(c => ({
    title: c.title,
    description: c.description ?? '',
  }));
  return {
    bookingId: b.id,
    reference: b.reference,
    status: b.status,
    confirmedAt: b.confirmed_at ?? null,
    accommodation,
    checkInDate: b.check_in_date,
    checkOutDate: b.check_out_date,
    nights: nightsBetween(b.check_in_date, b.check_out_date),
    rooms: b.rooms ?? (room ? 1 : 0),
    guests: Array.isArray(b.guests) ? b.guests.length : 0,
    roomName: room?.name ?? null,
    payer: payer ?? null,
    billing,
    cancellationTimeline,
    conditions,
    supportedLoyaltyProgrammeName:
      b.supported_loyalty_programme?.name ?? b.supported_loyalty_programme?.reference ?? null,
    business,
  };
}

export async function bookStay(input: BookStayInput, ctx?: ToolContext): Promise<BookStayResult> {
  // Payer resolution. Precedence: explicit input → ctx.payer (turn-level
  // resolution from dispatch) → resolvePayer fallback → undefined when
  // no traveler context is bound at all. Resolution failures (cross-
  // tenant trip etc.) bubble up.
  let provisionedBy: MeterPayerType | undefined =
    input.provisionedBy ?? ctx?.payer?.type ?? undefined;
  if (!provisionedBy && ctx?.traveler?.tenantId) {
    try {
      const resolved = await resolvePayer({
        tenantId: ctx.traveler.tenantId,
        tripId: input.tripId,
        travelerUserId: ctx.traveler.userId,
      });
      provisionedBy = resolved.type;
    } catch (err) {
      if (err instanceof PayerResolutionError && err.code === 'traveler_required') {
        provisionedBy = undefined;
      } else {
        throw err;
      }
    }
  }

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

  // Payer attribution line for the share card. `payerCopy` keeps the
  // tenant-vs-traveler wording consistent across operator/Slack/WhatsApp.
  // Falls back gracefully when payer was unresolved (legacy guest flows).
  const priceLine = `${booking.total_amount} ${booking.total_currency}`;
  const payerLine = provisionedBy
    ? payerCopy({
        payer: provisionedBy,
        amount: priceLine,
        tenantName: ctx?.traveler?.tenantId ?? null,
      }).lineItem
    : priceLine;

  const bullets = [
    `Ref ${booking.reference} · ${booking.status}`,
    `${booking.check_in_date} → ${booking.check_out_date}`,
    booking.accommodation?.name ?? '',
    payerLine,
    input.loyaltyProgrammeAccountNumber
      ? `Loyalty account: ${input.loyaltyProgrammeAccountNumber}`
      : '',
  ].filter(Boolean);

  const confirmation = buildBookingConfirmation(booking, provisionedBy, senderoBusinessDetails());

  // Post-confirmation email fan-out — fire-and-forget. Mirrors the
  // book_esim activation email pattern: the canonical reply already
  // ships, the email is durable backup so the traveler can pull up
  // the reference + cancellation policy + key collection from inbox.
  // Resend not configured / placeholder email / no email at all → no-op.
  void sendStayBookingConfirmedEmail({
    travelerEmail: input.email,
    confirmation,
    tripId: input.tripId,
    tenantId: ctx?.traveler?.tenantId,
  }).catch(err => {
    console.warn('[book_stay] confirmation email failed (non-fatal)', {
      bookingId: booking.id,
      reference: booking.reference,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  // Concierge-magic — profile write hook (fire-and-forget).
  // Appends destination city to visitedCities. book_flight already
  // bumped totalTrips + lastTripAt; the stay completes the memory
  // (we have both iso2 + city name from the Duffel response).
  // Spec: docs/architecture/concierge-magic.md §4.
  if (ctx?.traveler?.userId && ctx.traveler.tenantId) {
    void import('./lib/traveler-profile').then(m =>
      m.onStayBooked({
        userId: ctx.traveler!.userId!,
        tenantId: ctx.traveler!.tenantId!,
        destinationIso2: confirmation.accommodation.country,
        destinationCity: confirmation.accommodation.city,
      })
    ).catch(err => {
      console.warn('[book_stay] traveler profile write failed (non-fatal)', {
        userId: ctx.traveler?.userId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

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
    provisionedBy,
    stayBookingConfirmation: confirmation,
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
      provisionedBy: {
        type: 'string',
        enum: ['tenant', 'traveler'],
        description:
          'Override the trip-resolved payer. `tenant` = pre-paid budget; `traveler` = consumer wallet. Defaults to Trip.paymentMode.',
      },
      tripId: {
        type: 'string',
        description: 'Optional Trip.id for payer resolution.',
      },
    },
  },
  async handler(input, ctx) {
    if (ctx?.traveler?.isPlaceholder) {
      return {
        status: 'signin_required',
        message:
          "I need you to sign in once before booking — that's how your wallet, balances, and NFT stamps follow you across trips. Reply with the magic link the agent sends, sign in via WhatsApp OTP, and I'll continue this booking automatically.",
      } as unknown as BookStayResult;
    }
    return bookStay(input, ctx);
  },
};

// ─── Post-confirmation email fan-out ────────────────────────────────
//
// Mirrors the flight `emailBookingConfirmed` path: build a canonical
// `StayBookingConfirmedContent` from the same payload that powers the
// AI Element + channel renderers, hand it to
// `notifier.sendStayBookingConfirmed`. Lazy-imports notifications so the
// tools package stays importable in environments that strip Resend.
//
// Fail-soft contract: missing email, unconfigured Resend, send error all
// just log and return. The canonical agent reply (carrying the same
// payload via `stayBookingConfirmation`) is the primary surface.

async function sendStayBookingConfirmedEmail(args: {
  travelerEmail: string;
  confirmation: StayBookingConfirmationPayload;
  tripId?: string;
  tenantId?: string;
}): Promise<void> {
  const email = (args.travelerEmail ?? '').trim();
  if (!email) return;
  // Skip placeholder addresses — same gate book_flight + book_esim use.
  const lower = email.toLowerCase();
  if (
    lower.endsWith('@sendero.demo') ||
    lower.endsWith('@whatsapp-provisional.sendero.travel') ||
    lower.endsWith('@example.com')
  ) {
    return;
  }

  const { createNotifier, notificationsConfigured } = await import('@sendero/notifications');
  if (!notificationsConfigured()) return;

  const tripUrl =
    args.tripId && args.tenantId
      ? await buildTripBriefShareUrl({ tripId: args.tripId, tenantId: args.tenantId }).catch(
          () => null
        )
      : null;

  const c = args.confirmation;
  const notifier = createNotifier();
  await notifier.sendStayBookingConfirmed(email, {
    travelerName: 'Traveler',
    reference: c.reference,
    confirmedAt: c.confirmedAt,
    accommodation: {
      name: c.accommodation.name,
      address: c.accommodation.address,
      city: c.accommodation.city,
      country: c.accommodation.country,
      checkInAfter: c.accommodation.checkInAfter,
      checkOutBefore: c.accommodation.checkOutBefore,
      keyCollection: c.accommodation.keyCollection,
    },
    checkInDate: c.checkInDate,
    checkOutDate: c.checkOutDate,
    nights: c.nights,
    rooms: c.rooms,
    guests: c.guests,
    roomName: c.roomName,
    billing: c.billing,
    cancellationTimeline: c.cancellationTimeline.map(t => ({
      before: t.before,
      refundAmount: t.refundAmount,
      currency: t.currency,
    })),
    conditions: c.conditions.map(cond => ({
      title: cond.title,
      description: cond.description,
    })),
    tripUrl: tripUrl ?? null,
    business: c.business,
  });
}
