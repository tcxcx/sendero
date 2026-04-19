import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type { SwapParams } from '@circle-fin/app-kit';
import { env } from '@/lib/env';
import {
  getAppKit,
  getKitKey,
  getTreasuryAdapter,
  getTreasuryAddress,
  summarizeSwap,
} from '@/lib/appkit';

/**
 * POST /api/swap
 * Treasury-backed USDC ↔ EURC swap on Arc Testnet via Circle App Kit.
 *
 * Body: { from: 'USDC'|'EURC', to: 'USDC'|'EURC', amount: decimal string }
 */
const BodySchema = z.object({
  from: z.enum(['USDC', 'EURC']),
  to: z.enum(['USDC', 'EURC']),
  amount: z.string().regex(/^\d+(\.\d{1,6})?$/, 'Invalid amount'),
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  if (!env.circleApiKey() || !env.circleEntitySecret()) {
    return NextResponse.json(
      {
        error: 'circle_not_configured',
        message: 'CIRCLE_API_KEY + CIRCLE_ENTITY_SECRET required.',
      },
      { status: 503 },
    );
  }
  try {
    const body = BodySchema.parse(await req.json());
    if (body.from === body.to) {
      return NextResponse.json(
        { error: 'invalid_input', message: 'from and to must differ.' },
        { status: 400 },
      );
    }

    const treasuryAddress = getTreasuryAddress();
    const kit = getAppKit();
    const adapter = getTreasuryAdapter();

    const params: SwapParams = {
      from: {
        adapter,
        chain: 'Arc_Testnet',
        address: treasuryAddress as `0x${string}`,
      },
      tokenIn: body.from,
      tokenOut: body.to,
      amountIn: body.amount,
      config: { kitKey: getKitKey() },
    };

    const result = await kit.swap(params);
    return NextResponse.json({
      ...summarizeSwap(result),
      tokenIn: result.tokenIn,
      tokenOut: result.tokenOut,
      amountIn: result.amountIn,
      fees: result.fees ?? [],
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'invalid_input', issues: err.issues },
        { status: 400 },
      );
    }
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[swap] error:', detail);
    return NextResponse.json(
      { error: 'swap_failed', message: detail },
      { status: 500 },
    );
  }
}
