import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createHoldOrder } from '@/lib/duffel';
import { env } from '@/lib/env';

const BodySchema = z.object({
  offerId: z.string().min(1),
  passengerName: z.string().min(1),
  passengerEmail: z.string().email(),
  passengerDob: z.string().optional(),
  passengerGender: z.enum(['male', 'female']).optional(),
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = BodySchema.parse(await req.json());

    if (!env.duffelApiToken()) {
      return NextResponse.json({
        orderId: `demo_ord_${Date.now()}`,
        bookingReference: 'RG7F2K',
        totalAmount: '1842.00',
        totalCurrency: 'USD',
        paymentRequiredBy: new Date(Date.now() + 20 * 60_000).toISOString(),
        demo: true,
      });
    }

    const idempotencyKey = `pasillo-hold-${body.offerId}-${Date.now()}`;
    const result = await createHoldOrder({
      offerId: body.offerId,
      passengerName: body.passengerName,
      passengerEmail: body.passengerEmail,
      passengerDob: body.passengerDob,
      passengerGender: body.passengerGender,
      idempotencyKey,
    });
    return NextResponse.json({ ...result, demo: false });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'invalid_input', issues: err.issues },
        { status: 400 },
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'hold_failed', message }, { status: 500 });
  }
}
