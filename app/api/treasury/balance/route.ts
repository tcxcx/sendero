import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { getTreasuryBalances } from '@/lib/circle';
import { getArcStatus, getErc20Balance } from '@/lib/arc';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const treasuryAddress = env.circleTreasuryAddress();
  const hasCircle = !!env.circleApiKey() && !!env.circleTreasuryWalletId();

  if (!treasuryAddress && !hasCircle) {
    return NextResponse.json(
      {
        error: 'treasury_not_configured',
        message:
          'Set CIRCLE_API_KEY + CIRCLE_TREASURY_WALLET_ID (and CIRCLE_TREASURY_ADDRESS) in .env.local.',
      },
      { status: 503 },
    );
  }

  try {
    const [balances, arcStatus, onchain] = await Promise.all([
      hasCircle
        ? getTreasuryBalances().catch(() => null)
        : Promise.resolve(null),
      getArcStatus().catch(() => null),
      treasuryAddress
        ? getOnChainBalances(treasuryAddress)
        : Promise.resolve(null),
    ]);

    // Prefer Circle-reported balances, fall back to on-chain ERC-20 reads.
    const effectiveBalances =
      balances && balances.length > 0
        ? balances
        : onchain && onchain.length > 0
          ? onchain
          : [];

    if (!arcStatus) {
      return NextResponse.json(
        {
          error: 'arc_rpc_failed',
          message: `Failed to reach Arc RPC at ${env.arcRpcUrl()}.`,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      treasuryAddress: treasuryAddress ?? null,
      balances: effectiveBalances,
      arc: arcStatus,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: 'balance_failed', message },
      { status: 500 },
    );
  }
}

async function getOnChainBalances(treasuryAddress: string) {
  const usdc = env.arcUsdcAddress();
  const eurc = env.arcEurcAddress();
  if (!usdc && !eurc) return null;

  const out: {
    symbol: string;
    amount: string;
    chain: string;
    decimals: number;
  }[] = [];
  if (usdc) {
    try {
      const b = await getErc20Balance(usdc as any, treasuryAddress as any);
      out.push({ ...b, chain: 'ARC' });
    } catch {
      /* ignore */
    }
  }
  if (eurc) {
    try {
      const b = await getErc20Balance(eurc as any, treasuryAddress as any);
      out.push({ ...b, chain: 'ARC' });
    } catch {
      /* ignore */
    }
  }
  return out.length > 0 ? out : null;
}
