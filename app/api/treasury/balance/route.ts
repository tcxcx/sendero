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

  try {
    const [balances, arcStatus, onchain] = await Promise.all([
      hasCircle ? getTreasuryBalances().catch(() => null) : Promise.resolve(null),
      getArcStatus().catch(() => null),
      treasuryAddress ? getOnChainBalances(treasuryAddress) : Promise.resolve(null),
    ]);

    const effectiveBalances =
      balances && balances.length > 0
        ? balances
        : onchain && onchain.length > 0
          ? onchain
          : demoBalances();

    return NextResponse.json({
      treasuryAddress: treasuryAddress || '0x7a2e…b18c',
      balances: effectiveBalances,
      arc: arcStatus || demoArcStatus(),
      demo: !balances && !onchain,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'balance_failed', message }, { status: 500 });
  }
}

async function getOnChainBalances(treasuryAddress: string) {
  const usdc = env.arcUsdcAddress();
  const eurc = env.arcEurcAddress();
  if (!usdc && !eurc) return null;

  const out: { symbol: string; amount: string; chain: string; decimals: number }[] = [];
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

function demoBalances() {
  return [
    { symbol: 'USDC', amount: '412904.00', decimals: 6, chain: 'ARC' },
    { symbol: 'EURC', amount: '88162.00', decimals: 6, chain: 'ARC' },
  ];
}

function demoArcStatus() {
  return {
    blockNumber: '8482114',
    gasPrice: '40000',
    chainId: 421,
    rpcUrl: 'https://rpc.arc-sepolia.circle.com',
    explorerUrl: 'https://explorer.arc-sepolia.circle.com',
  };
}
