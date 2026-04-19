import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type { BridgeParams } from '@circle-fin/app-kit';
import { env } from '@/lib/env';
import {
  getAppKit,
  getTreasuryAdapter,
  getTreasuryAddress,
  summarizeBridge,
} from '@/lib/appkit';

/**
 * POST /api/bridge
 * Cross-chain USDC bridge INTO Arc Testnet via App Kit CCTP.
 * Body: { fromChain: 'Ethereum_Sepolia'|'Base_Sepolia'|…, amount: decimal }
 */
import { BRIDGE_CHAINS } from '@/lib/bridge-chains';

const BodySchema = z.object({
  fromChain: z.enum(BRIDGE_CHAINS),
  amount: z.string().regex(/^\d+(\.\d{1,6})?$/),
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

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

    const params: BridgeParams = {
      from: {
        adapter,
        chain: body.fromChain,
        address: treasuryAddress as `0x${string}`,
      },
      to: {
        adapter,
        chain: 'Arc_Testnet',
        address: treasuryAddress as `0x${string}`,
      },
      amount: body.amount,
    };

    const result = await kit.bridge(params);
    return NextResponse.json({
      ...summarizeBridge(result),
      amount: body.amount,
      fromChain: body.fromChain,
      toChain: 'Arc_Testnet',
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'invalid_input', issues: err.issues },
        { status: 400 },
      );
    }
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[bridge] error:', detail);
    return NextResponse.json(
      { error: 'bridge_failed', message: detail },
      { status: 500 },
    );
  }
}
