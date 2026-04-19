import { NextRequest, NextResponse } from 'next/server';
import { payFromBalance } from '@/lib/duffel';
import { env } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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
    const { id } = await params;
    const result = await payFromBalance(id);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: 'payment_failed', message },
      { status: 500 },
    );
  }
}
