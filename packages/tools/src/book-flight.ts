import { z } from 'zod';
import {
  createHoldOrder,
  getAirlineCredit,
  payFromBalance,
  payOrder,
  type DuffelAirlineCreditId,
  type DuffelPaymentInput,
} from '@sendero/duffel';
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
  /**
   * Optional Duffel airline credit (`acd_…`) to redeem toward this
   * booking. If the credit doesn't cover the full order, the remainder
   * is paid from balance. If the credit is larger than the fare, only
   * the fare amount is charged (Duffel applies airline-specific residual
   * rules — see /guides/using-airline-credits).
   */
  airlineCreditId: z.string().optional(),
});

type BookFlightInput = z.infer<typeof inputSchema>;

export const bookFlightTool: ToolDef = {
  name: 'book_flight',
  description:
    'Book a flight via Duffel for the signed-in user: ensures the Duffel CustomerUser exists, creates a hold order (with any ancillary services attached), and pays from the pre-funded Duffel Balance — optionally splitting payment with a traveler airline credit. Returns the PNR + order id. The traveler automatically gets Travel Support Assistant access through their linked icu_… identity. Passenger identity comes from the signed-in Clerk session — do not ask the user for name, email, or phone.',
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
      airlineCreditId: {
        type: 'string',
        description:
          'Duffel airline credit id (acd_…) to redeem toward this booking. Remainder paid from balance.',
      },
    },
  },
  async handler(input: BookFlightInput, ctx?: ToolContext) {
    const travelerName = ctx?.traveler?.name || 'Traveler';
    const travelerEmail = ctx?.traveler?.email || 'traveler@sendero.demo';
    const travelerPhone = ctx?.traveler?.phone || undefined;

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

    let paymentStatus: string;
    let paymentBreakdown:
      | Array<{ type: string; amount: string; currency: string; creditId?: string }>
      | undefined;

    if (input.airlineCreditId) {
      // Credit + balance split. Duffel enforces currency and residual rules
      // airline-side; we just sanity check that the credit currency matches
      // the order currency and cap the credit portion at the order total.
      try {
        const credit = await getAirlineCredit(input.airlineCreditId);
        if (credit.spent_at || credit.invalidated_at) {
          throw new Error(
            `airline credit ${credit.id} is ${credit.spent_at ? 'already spent' : 'invalidated'}`
          );
        }
        if (credit.amount_currency !== hold.totalCurrency) {
          throw new Error(
            `airline credit currency ${credit.amount_currency} does not match order currency ${hold.totalCurrency}`
          );
        }
        const orderTotal = Number(hold.totalAmount);
        const creditAvail = Number(credit.amount);
        const creditPortion = Math.min(orderTotal, creditAvail).toFixed(2);
        const balancePortion = (orderTotal - Number(creditPortion)).toFixed(2);

        const payments: DuffelPaymentInput[] = [
          {
            type: 'airline_credit',
            airline_credit_id: credit.id as DuffelAirlineCreditId,
            amount: creditPortion,
            currency: hold.totalCurrency,
          },
        ];
        if (Number(balancePortion) > 0) {
          payments.push({
            type: 'balance',
            amount: balancePortion,
            currency: hold.totalCurrency,
          });
        }

        const result = await payOrder({ orderId: hold.orderId, payments });
        paymentStatus = result[0]?.status ?? 'pending';
        paymentBreakdown = result.map(p => ({
          type: p.type,
          amount: p.amount,
          currency: p.currency,
          creditId: p.airline_credit_id,
        }));
      } catch (err) {
        console.warn(
          '[book_flight] airline credit split failed, falling back to balance-only',
          err
        );
        const payment = await payFromBalance(hold.orderId);
        paymentStatus = payment.status;
      }
    } else {
      const payment = await payFromBalance(hold.orderId);
      paymentStatus = payment.status;
    }

    return {
      orderId: hold.orderId,
      pnr: hold.bookingReference,
      totalAmount: hold.totalAmount,
      totalCurrency: hold.totalCurrency,
      paymentStatus,
      servicesAttached: hold.services,
      customerUserIds,
      airlineCreditRedeemed: Boolean(input.airlineCreditId) && Boolean(paymentBreakdown),
      paymentBreakdown,
    };
  },
};
