import { NextResponse } from 'next/server';
import { queryUnifiedBalance } from '@/lib/gateway';
import { env } from '@/lib/env';

/**
 * GET /api/gateway/balance
 * Returns the Sendero treasury's unified USDC balance across every
 * Gateway-supported testnet we track, plus the per-chain breakdown.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!env.treasuryPrivateKey()) {
    return NextResponse.json(
      {
        error: 'treasury_not_configured',
        message: 'TREASURY_PRIVATE_KEY required for Gateway.',
      },
      { status: 503 },
    );
  }
  try {
    const snapshot = await queryUnifiedBalance();
    return NextResponse.json(snapshot);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[gateway/balance] error:', detail);
    return NextResponse.json(
      { error: 'gateway_balance_failed', message: detail },
      { status: 500 },
    );
  }
}
