import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { searchFlights } from '@/lib/duffel';
import { env } from '@/lib/env';

const BodySchema = z.object({
  origin: z.string().length(3),
  destination: z.string().length(3),
  departureDate: z.string(),
  returnDate: z.string().optional(),
  passengers: z.number().int().min(1).max(9).default(1),
  cabinClass: z
    .enum(['economy', 'premium_economy', 'business', 'first'])
    .default('economy'),
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
      { status: 503 },
    );
  }

  try {
    const body = BodySchema.parse(await req.json());
    const offers = await searchFlights(body as any);
    return NextResponse.json({ offers });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'invalid_input', issues: err.issues },
        { status: 400 },
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: 'search_failed', message },
      { status: 500 },
    );
  }
}
