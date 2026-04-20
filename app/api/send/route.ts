import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { env } from '@/lib/env';
import { getCircle } from '@/lib/circle';

/**
 * POST /api/send
 * Same-chain treasury transfer on Arc Testnet via Circle DCW.
 *
 * App Kit's `kit.send()` calls `adapter.getAddress()` internally even when
 * `from.address` is supplied, which blows up for developer-controlled
 * adapters (see @circle-fin/app-kit v1.3 `prepareSend`). For dev-controlled
 * treasury wallets we don't need App Kit at all — Circle DCW
 * `createTransaction` is the lower-friction, battle-tested path.
 *
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
  const treasuryAddress = env.circleTreasuryAddress();
  const hasCircle = !!env.circleApiKey() && !!env.circleTreasuryWalletId();
  if (!treasuryAddress || !hasCircle) {
    return NextResponse.json(
      {
        error: 'treasury_not_configured',
        message:
          'Set CIRCLE_API_KEY + CIRCLE_TREASURY_WALLET_ID + CIRCLE_TREASURY_ADDRESS in .env.local.',
      },
      { status: 503 },
    );
  }

  try {
    const body = BodySchema.parse(await req.json());
    const tokenAddress =
      body.token === 'USDC' ? env.arcUsdcAddress() : env.arcEurcAddress();

    const circle = getCircle();
    const response = await circle.createTransaction({
      walletAddress: treasuryAddress,
      blockchain: 'ARC-TESTNET' as any,
      tokenAddress,
      destinationAddress: body.to,
      amount: [body.amount],
      fee: { type: 'level', config: { feeLevel: 'MEDIUM' as any } },
      refId: `treasury-send-${Date.now()}`,
    } as any);

    const data: any = (response as any).data ?? {};
    return NextResponse.json({
      state: data?.state ?? 'INITIATED',
      txId: data?.id ?? null,
      txHash: data?.txHash ?? null,
      explorerUrl: data?.txHash
        ? `${env.arcExplorerUrl()}/tx/${data.txHash}`
        : null,
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
    const anyErr = err as any;
    const detail =
      anyErr?.response?.data?.message ||
      (err instanceof Error ? err.message : String(err));
    console.error('[send] error:', detail);
    return NextResponse.json(
      { error: 'send_failed', message: detail },
      { status: 500 },
    );
  }
}
