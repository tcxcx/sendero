import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { searchHotels } from '@/lib/duffel';
import { env } from '@/lib/env';

const BodySchema = z.object({
  location: z.string().min(2),
  checkInDate: z.string(),
  checkOutDate: z.string(),
  guests: z.number().int().min(1).max(9).default(1),
  rooms: z.number().int().min(1).max(9).default(1),
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = BodySchema.parse(await req.json());

    if (!env.duffelApiToken()) {
      return NextResponse.json({
        error: 'duffel_not_configured',
        message: 'Set DUFFEL_API_TOKEN in .env.local to run real hotel searches.',
        demoHint: { demoHotels: buildDemoHotels(body) },
      });
    }

    const hotels = await searchHotels(body as any);
    return NextResponse.json({ hotels, demo: false });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'invalid_input', issues: err.issues },
        { status: 400 },
      );
    }
    const anyErr = err as any;
    const duffelErrors = anyErr?.errors ?? anyErr?.response?.data?.errors;
    console.error('[hotels/search] full error:', err);
    console.error('[hotels/search] keys:', Object.keys(anyErr || {}));
    console.error('[hotels/search] error.name:', anyErr?.name);
    console.error('[hotels/search] error.code:', anyErr?.code);
    console.error('[hotels/search] error.stack:', anyErr?.stack?.split('\n').slice(0, 5).join('\n'));
    const message =
      (duffelErrors && JSON.stringify(duffelErrors)) ||
      (err instanceof Error ? err.message : String(err)) ||
      'unknown';
    return NextResponse.json({ error: 'search_failed', message }, { status: 500 });
  }
}

function buildDemoHotels(body: z.infer<typeof BodySchema>) {
  const nights = Math.max(
    1,
    Math.round(
      (new Date(body.checkOutDate).getTime() -
        new Date(body.checkInDate).getTime()) /
        (1000 * 60 * 60 * 24),
    ),
  );
  return [
    {
      id: 'demo_hotel_1',
      name: 'The Hoxton, Shoreditch',
      city: body.location,
      country: 'GB',
      stars: 4,
      reviewScore: 8.6,
      photos: [
        'https://images.duffel.com/stays/example-hoxton-1.jpg',
        'https://images.duffel.com/stays/example-hoxton-2.jpg',
      ],
      price: (214 * nights).toFixed(2),
      currency: 'GBP',
      cancellation: 'free',
      distanceMeters: 1200,
      amenities: ['wifi', 'breakfast', 'gym', 'bar'],
    },
    {
      id: 'demo_hotel_2',
      name: 'citizenM Tower of London',
      city: body.location,
      country: 'GB',
      stars: 4,
      reviewScore: 8.9,
      photos: ['https://images.duffel.com/stays/example-citizenm.jpg'],
      price: (199 * nights).toFixed(2),
      currency: 'GBP',
      cancellation: 'partial',
      distanceMeters: 800,
      amenities: ['wifi', 'self_checkin'],
    },
  ];
}
