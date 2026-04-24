/**
 * GET /api/wallet/balance?address=0x…
 *
 * Returns the cached USDC + EURC balance for a CircleWallet, keyed
 * by on-chain address. Updated by the Circle webhook; do not poll
 * viem from the browser.
 */

import { NextResponse, type NextRequest } from 'next/server';

import { prisma } from '@sendero/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get('address');
  if (!address) {
    return NextResponse.json({ error: 'missing_address' }, { status: 400 });
  }

  const wallet = await prisma.circleWallet.findUnique({
    where: { address: address.toLowerCase() },
    select: {
      address: true,
      usdcBalanceMicro: true,
      eurcBalanceMicro: true,
      balanceUpdatedAt: true,
    },
  });

  if (!wallet) {
    return NextResponse.json({ error: 'wallet_not_found' }, { status: 404 });
  }

  return NextResponse.json({
    address: wallet.address,
    usdc: wallet.usdcBalanceMicro?.toString() ?? '0',
    eurc: wallet.eurcBalanceMicro?.toString() ?? '0',
    updatedAt: wallet.balanceUpdatedAt?.toISOString() ?? null,
  });
}
