import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type { SendParams } from '@circle-fin/app-kit';
import { env } from '@/lib/env';
import {
  getAppKit,
  getTreasuryAdapter,
  getTreasuryAddress,
  summarizeSend,
} from '@/lib/appkit';

/**
 * POST /api/send
 * Same-chain treasury transfer on Arc Testnet via App Kit.
 * Body: { to: 0xAddress, amount: decimal, token?: 'USDC'|'EURC' }
 */
const BodySchema = z.object({
  to: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  amount: z.string().regex(/^\d+(\.\d{1,6})?$/),
  token: z.enum(['USDC', 'EURC']).default('USDC'),
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
    const treasuryAddress = getTreasuryAddress();
    const kit = getAppKit();
    const adapter = getTreasuryAdapter();

    const params: SendParams = {
      from: {
        adapter,
        chain: 'Arc_Testnet',
        address: treasuryAddress as `0x${string}`,
      },
      to: body.to,
      amount: body.amount,
      token: body.token,
    };

    const result = await kit.send(params);
    return NextResponse.json({
      ...summarizeSend(result),
      amount: body.amount,
      token: body.token,
      to: body.to,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'invalid_input', issues: err.issues },
        { status: 400 },
      );
    }
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[send] error:', detail);
    return NextResponse.json(
      { error: 'send_failed', message: detail },
      { status: 500 },
    );
  }
}
