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
    const hotels = await searchHotels(body as any);
    return NextResponse.json({ hotels });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'invalid_input', issues: err.issues },
        { status: 400 },
      );
    }
    const anyErr = err as any;
    const duffelErrors = anyErr?.errors ?? anyErr?.response?.data?.errors;
    const message =
      (duffelErrors && JSON.stringify(duffelErrors)) ||
      (err instanceof Error ? err.message : String(err)) ||
      'unknown';
    return NextResponse.json(
      { error: 'search_failed', message },
      { status: 500 },
    );
  }
}
