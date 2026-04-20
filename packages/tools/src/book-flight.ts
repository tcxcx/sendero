import { z } from 'zod';
import { createHoldOrder, payFromBalance } from '../../../lib/duffel';
import type { ToolDef, ToolContext } from './types';

const inputSchema = z.object({
  offerId: z.string(),
});

export const bookFlightTool: ToolDef = {
  name: 'book_flight',
  description:
    'Book a flight via Duffel for the signed-in user: creates a hold order and pays from the pre-funded Duffel Balance. Returns the PNR (booking reference) and order ID. After this succeeds, the user will settle on-chain themselves from the Settlement panel. Passenger identity is supplied by the server from the signed-in session — do not ask the user for name or email.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['offerId'],
    properties: {
      offerId: { type: 'string' },
    },
  },
  async handler({ offerId }: { offerId: string }, ctx?: ToolContext) {
    const travelerName = ctx?.traveler?.name || 'Traveler';
    const travelerEmail = ctx?.traveler?.email || 'traveler@sendero.demo';
    const travelerPhone = ctx?.traveler?.phone || undefined;
    const hold = await createHoldOrder({
      offerId,
      passengerName: travelerName,
      passengerEmail: travelerEmail,
      passengerPhone: travelerPhone,
      idempotencyKey: `sendero-${offerId}-${Date.now()}`,
    });
    const payment = await payFromBalance(hold.orderId);
    return {
      orderId: hold.orderId,
      pnr: hold.bookingReference,
      totalAmount: hold.totalAmount,
      totalCurrency: hold.totalCurrency,
      paymentStatus: payment.status,
    };
  },
};
