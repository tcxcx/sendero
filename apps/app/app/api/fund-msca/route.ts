import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCircle } from '@sendero/circle/wallets';
import { env } from '@sendero/env';

/**
 * POST /api/fund-msca
 * Sandbox-only: drip USDC from the Sendero treasury (Circle DCW) to the
 * user's MSCA so the one-userOp settlement has something to spend.
 *
 * Body: { to: 0x<40hex>, amount?: "5" }   (amount clamped to 0.1–20 USDC)
 */
const BodySchema = z.object({
  to: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid MSCA address'),
  amount: z.string().optional(),
});

const MIN_AMOUNT = 0.1;
const MAX_AMOUNT = 20;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  // Dev-only kill switch. Without this gate the route accepts any
  // POST and drains up to 20 USDC per call from Sendero treasury to
  // any address — `to` is freely set in the body. The matching UI
  // gate in apps/app/components/deposit-dialog.tsx hides the button
  // but doesn't close the route. Keep both in sync.
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json(
      { error: 'dev_only', message: 'Treasury drip is disabled outside development.' },
      { status: 403 }
    );
  }

  const treasuryAddress = env.circleTreasuryAddress();
  const hasCircle = !!env.circleApiKey() && !!env.circleTreasuryWalletId();
  if (!treasuryAddress || !hasCircle) {
    return NextResponse.json(
      {
        error: 'treasury_not_configured',
        message:
          'Set CIRCLE_API_KEY + CIRCLE_TREASURY_WALLET_ID + CIRCLE_TREASURY_ADDRESS in .env.local.',
      },
      { status: 503 }
    );
  }

  try {
    const body = BodySchema.parse(await req.json());
    const amount = body.amount ?? '5';
    const n = Number(amount);
    if (!Number.isFinite(n) || n < MIN_AMOUNT || n > MAX_AMOUNT) {
      return NextResponse.json(
        {
          error: 'invalid_amount',
          message: `Amount must be between ${MIN_AMOUNT} and ${MAX_AMOUNT} USDC.`,
        },
        { status: 400 }
      );
    }

    const circle = getCircle();
    const response = await circle.createTransaction({
      walletAddress: treasuryAddress,
      blockchain: 'ARC-TESTNET' as any,
      tokenAddress: env.arcUsdcAddress(),
      destinationAddress: body.to,
      amount: [amount],
      fee: { type: 'level', config: { feeLevel: 'MEDIUM' as any } },
      refId: `msca-drip-${Date.now()}`,
    } as any);

    const data: any = (response as any).data ?? {};
    return NextResponse.json({
      txId: data?.id ?? null,
      state: data?.state ?? 'INITIATED',
      amount,
      to: body.to,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'invalid_input', issues: err.issues }, { status: 400 });
    }
    const anyErr = err as any;
    const detail =
      anyErr?.response?.data?.message || (err instanceof Error ? err.message : String(err));
    console.error('[fund-msca] error:', detail);
    return NextResponse.json({ error: 'fund_failed', message: detail }, { status: 500 });
  }
}
