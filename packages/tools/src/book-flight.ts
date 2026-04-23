import { z } from 'zod';
import { createHoldOrder, payFromBalance } from '@sendero/duffel';
import type { ToolDef, ToolContext } from './types';
import { ensureDuffelCustomer } from './ensure-duffel-customer';

const serviceSchema = z.object({
  id: z.string().min(1),
  quantity: z.number().int().min(1).max(9).default(1),
});

const inputSchema = z.object({
  offerId: z.string(),
  /**
   * Optional ancillary services (bags, seats, CFAR) to attach at order
   * creation time. Get these from `list_flight_ancillaries`.
   */
  services: z.array(serviceSchema).optional(),
  /**
   * Additional Duffel CustomerUser ids (`icu_…`) that should have access
   * to this order. The primary traveler is always resolved from the
   * Clerk session via `ensure_duffel_customer` — this list is for team
   * leads, assistants, and other parties who should see the order.
   */
  additionalCustomerUserIds: z.array(z.string().min(3)).optional(),
});

type BookFlightInput = z.infer<typeof inputSchema>;

export const bookFlightTool: ToolDef = {
  name: 'book_flight',
  description:
    'Book a flight via Duffel for the signed-in user: ensures the Duffel CustomerUser exists, creates a hold order (with any ancillary services attached), and pays from the pre-funded Duffel Balance. Returns the PNR + order id. The traveler automatically gets Travel Support Assistant access through their linked icu_… identity. Passenger identity comes from the signed-in Clerk session — do not ask the user for name, email, or phone.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['offerId'],
    properties: {
      offerId: { type: 'string' },
      services: {
        type: 'array',
        description: 'Ancillary service ids + quantities from list_flight_ancillaries.',
        items: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string' },
            quantity: { type: 'integer', default: 1, minimum: 1, maximum: 9 },
          },
        },
      },
      additionalCustomerUserIds: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Additional icu_… ids to attach (personal assistant, team lead, etc.). The primary traveler is auto-resolved from the session.',
      },
    },
  },
  async handler(input: BookFlightInput, ctx?: ToolContext) {
    const travelerName = ctx?.traveler?.name || 'Traveler';
    const travelerEmail = ctx?.traveler?.email || 'traveler@sendero.demo';
    const travelerPhone = ctx?.traveler?.phone || undefined;

    // Best-effort Duffel identity sync. If we have a Clerk session,
    // ensure a CustomerUser exists and pin it to the order so Travel
    // Support Assistant unlocks for this traveler. If the sync fails
    // (missing membership, Duffel API hiccup), we still proceed with
    // the booking — the customer-user link is additive, not required.
    const customerUserIds: string[] = [];
    if (ctx?.traveler?.userId) {
      try {
        const identity = await ensureDuffelCustomer(
          { clerkUserId: ctx.traveler.userId, tenantId: ctx.traveler.tenantId },
          ctx
        );
        customerUserIds.push(identity.duffelCustomerUserId);
      } catch (err) {
        console.warn('[book_flight] ensure_duffel_customer failed, continuing without link', err);
      }
    }
    if (input.additionalCustomerUserIds?.length) {
      for (const id of input.additionalCustomerUserIds) {
        if (id && !customerUserIds.includes(id)) customerUserIds.push(id);
      }
    }

    const services = input.services?.map(s => ({
      id: s.id,
      quantity: s.quantity ?? 1,
    }));
    const hold = await createHoldOrder({
      offerId: input.offerId,
      passengerName: travelerName,
      passengerEmail: travelerEmail,
      passengerPhone: travelerPhone,
      idempotencyKey: `sendero-${input.offerId}-${Date.now()}`,
      customerUserIds: customerUserIds.length ? customerUserIds : undefined,
      services,
    });
    const payment = await payFromBalance(hold.orderId);
    return {
      orderId: hold.orderId,
      pnr: hold.bookingReference,
      totalAmount: hold.totalAmount,
      totalCurrency: hold.totalCurrency,
      paymentStatus: payment.status,
      servicesAttached: hold.services,
      customerUserIds,
    };
  },
};
