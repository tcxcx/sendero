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
  try {
    const body = BodySchema.parse(await req.json());

    if (!env.duffelApiToken()) {
      return NextResponse.json(
        {
          error: 'duffel_not_configured',
          message:
            'Set DUFFEL_API_TOKEN in .env.local to run real flight searches.',
          demoHint: {
            demoOffers: buildDemoOffers(body),
          },
        },
        { status: 200 },
      );
    }

    const offers = await searchFlights(body as any);
    return NextResponse.json({ offers, demo: false });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'invalid_input', issues: err.issues },
        { status: 400 },
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'search_failed', message }, { status: 500 });
  }
}

function buildDemoOffers(body: z.infer<typeof BodySchema>) {
  const base = [
    { airline: 'British Airways', duration: 'PT10H25M', price: '1842.00' },
    { airline: 'United', duration: 'PT11H05M', price: '1968.00' },
    { airline: 'Delta', duration: 'PT10H50M', price: '1724.00' },
  ];
  const depTs = new Date(body.departureDate);
  return base.map((b, i) => ({
    id: `demo_off_${i}`,
    airline: b.airline,
    price: b.price,
    currency: 'USD',
    departure: new Date(depTs.getTime() + i * 3_600_000).toISOString(),
    arrival: new Date(
      depTs.getTime() + i * 3_600_000 + 10 * 3_600_000,
    ).toISOString(),
    duration: b.duration,
    stops: 0,
    cabinClass: body.cabinClass,
    expiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
  }));
}
