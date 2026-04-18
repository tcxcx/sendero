import { NextRequest, NextResponse } from 'next/server';
import { payFromBalance } from '@/lib/duffel';
import { env } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    if (!env.duffelApiToken()) {
      return NextResponse.json({
        paymentId: `demo_pay_${Date.now()}`,
        status: 'succeeded',
        amount: '1842.00',
        currency: 'USD',
        demo: true,
      });
    }

    const result = await payFromBalance(id);
    return NextResponse.json({ ...result, demo: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'payment_failed', message }, { status: 500 });
  }
}
