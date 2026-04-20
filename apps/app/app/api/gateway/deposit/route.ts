import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { GATEWAY_CHAINS, depositToGateway } from '@sendero/circle/gateway';
import { env } from '@sendero/env';

/**
 * POST /api/gateway/deposit
 * Seed the treasury's Gateway balance on a source chain. Runs
 * `approve` + `deposit` against the GatewayWallet contract.
 * Body: { chain: chainKey, amount: decimal }
 */
const BodySchema = z.object({
  chain: z.enum(Object.keys(GATEWAY_CHAINS) as [string, ...string[]]),
  amount: z.string().regex(/^\d+(\.\d{1,6})?$/),
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  if (!env.treasuryPrivateKey()) {
    return NextResponse.json(
      {
        error: 'treasury_not_configured',
        message: 'TREASURY_PRIVATE_KEY required for Gateway.',
      },
      { status: 503 }
    );
  }
  try {
    const body = BodySchema.parse(await req.json());
    const result = await depositToGateway(body.chain as keyof typeof GATEWAY_CHAINS, body.amount);
    return NextResponse.json({
      state: 'success',
      chain: body.chain,
      amount: body.amount,
      approveHash: result.approveHash,
      depositHash: result.depositHash,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'invalid_input', issues: err.issues }, { status: 400 });
    }
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[gateway/deposit] error:', detail);
    return NextResponse.json({ error: 'gateway_deposit_failed', message: detail }, { status: 500 });
  }
}
