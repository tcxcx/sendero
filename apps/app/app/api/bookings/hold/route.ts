import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createHoldOrder } from '@sendero/duffel';
import { env } from '@sendero/env';

const BodySchema = z.object({
  offerId: z.string().min(1),
  passengerName: z.string().min(1),
  passengerEmail: z.string().email(),
  passengerPhone: z.string().regex(/^\+[1-9]\d{6,14}$/),
  passengerDob: z.string().optional(),
  passengerGender: z.enum(['male', 'female']).optional(),
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!env.duffelApiToken()) {
    return NextResponse.json(
      {
        error: 'duffel_not_configured',
        message: 'Set DUFFEL_API_TOKEN in .env.local.',
      },
      { status: 503 }
    );
  }

  try {
    const body = BodySchema.parse(await req.json());
    const idempotencyKey = `sendero-hold-${body.offerId}-${Date.now()}`;
    const result = await createHoldOrder({
      offerId: body.offerId,
      passengerName: body.passengerName,
      passengerEmail: body.passengerEmail,
      passengerPhone: body.passengerPhone,
      passengerDob: body.passengerDob,
      passengerGender: body.passengerGender,
      idempotencyKey,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'invalid_input', issues: err.issues }, { status: 400 });
    }
    const anyErr = err as any;
    const duffelErrors = anyErr?.errors ?? anyErr?.response?.data?.errors ?? null;
    const message =
      (duffelErrors &&
        duffelErrors.map((e: any) => e.title || e.message || JSON.stringify(e)).join('; ')) ||
      (err instanceof Error ? err.message : String(err)) ||
      'unknown';
    const userMessage = /invalid order create type/i.test(message)
      ? 'This offer cannot be held by the airline. Choose another offer or run a new search for holdable inventory.'
      : message;
    console.error('[bookings/hold] duffel error:', duffelErrors || err);
    return NextResponse.json({ error: 'hold_failed', message: userMessage }, { status: 500 });
  }
}
