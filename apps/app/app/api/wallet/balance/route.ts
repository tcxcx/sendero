/**
 * GET /api/wallet/balance?address=0x…
 *
 * Returns the cached USDC + EURC balance for a CircleWallet, keyed
 * by on-chain address. Updated by the Circle webhook; do not poll
 * viem from the browser.
 *
 * Tenant-scoped: requires a Clerk session + matching org. Returns 404
 * if the address does not belong to the caller's tenant (same code
 * path as "wallet doesn't exist" — we don't leak the existence of
 * other tenants' wallets via the error shape).
 */

import { NextResponse, type NextRequest } from 'next/server';

import { auth } from '@clerk/nextjs/server';
import { prisma } from '@sendero/database';

import { canonicalizeAddress } from '@/lib/address-case';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { orgId } = await auth();
  if (!orgId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const address = req.nextUrl.searchParams.get('address');
  if (!address) {
    return NextResponse.json({ error: 'missing_address' }, { status: 400 });
  }

  const tenant = await prisma.tenant.findUnique({
    where: { clerkOrgId: orgId },
    select: { id: true },
  });
  if (!tenant) {
    return NextResponse.json({ error: 'wallet_not_found' }, { status: 404 });
  }

  // Scope by tenantId. `findFirst` over the compound filter instead of
  // `findUnique({ address })` because a valid address owned by another
  // tenant must 404, not leak.
  //
  // Address canonicalization is chain-aware. EVM addresses lowercase
  // safely; Solana base58 is case-sensitive and lowercasing would never
  // match the stored row (which preserves case in
  // provisionTenantSolanaTreasury).
  const wallet = await prisma.circleWallet.findFirst({
    where: { address: canonicalizeAddress(address), tenantId: tenant.id },
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
