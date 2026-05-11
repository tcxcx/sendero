/**
 * GET /api/wallet/balance?address=0x…[&live=1]
 *
 * Returns the cached USDC + EURC balance for a CircleWallet, keyed
 * by on-chain address. Updated by the Circle webhook; do not poll
 * viem from the browser.
 *
 * Tenant-scoped: requires a Clerk session + matching org. Returns 404
 * if the address does not belong to the caller's tenant (same code
 * path as "wallet doesn't exist" — we don't leak the existence of
 * other tenants' wallets via the error shape).
 *
 * `?live=1`: opt-in fresh read for Solana treasury wallets. When set
 * AND the queried row is `chain='SOL-DEVNET'` AND
 * `kind='treasury'`, the route reads the USDC balance directly from
 * Solana RPC (bypassing the Circle webhook cache) and reconciles
 * upward into `usdcBalanceMicro` if the on-chain value is higher.
 * Treasury wallets are at risk of stale cache because the vault PDA
 * isn't a Circle-managed wallet in the usual sense — Circle's
 * balance sync may skip it. See TODO.md "Treasury balance — Solana
 * RPC fallback" for the full rationale.
 *
 * Arc MSCA + Operations DCWs stay on the cached column; Circle is
 * authoritative there.
 */

import { NextResponse, type NextRequest } from 'next/server';

import { auth } from '@clerk/nextjs/server';
import { prisma } from '@sendero/database';

import { canonicalizeAddress } from '@/lib/address-case';
import { readSolanaUsdcBalance } from '@/lib/solana-balance';

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
  const live = req.nextUrl.searchParams.get('live') === '1';

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
  const lookup = canonicalizeAddress(address);
  const wallet = await prisma.circleWallet.findFirst({
    where: { address: lookup, tenantId: tenant.id },
    select: {
      id: true,
      address: true,
      chain: true,
      kind: true,
      usdcBalanceMicro: true,
      eurcBalanceMicro: true,
      balanceUpdatedAt: true,
    },
  });

  if (!wallet) {
    return NextResponse.json({ error: 'wallet_not_found' }, { status: 404 });
  }

  // Live RPC fallback for Sol treasury vaults. Gated tightly:
  //   - Only when ?live=1 (opt-in; SSE stream + dashboard mount stay cached).
  //   - Only Solana — Arc MSCAs trust the Circle webhook.
  //   - Only treasury kind — Operations DCWs already have their own
  //     hot path via /api/gateway/balance.
  let usdcMicro = wallet.usdcBalanceMicro ?? 0n;
  let updatedAt = wallet.balanceUpdatedAt;
  let liveSource: 'rpc' | 'cache' = 'cache';

  if (live && wallet.chain === 'SOL-DEVNET' && wallet.kind === 'treasury') {
    try {
      const rpc = await readSolanaUsdcBalance(wallet.address);
      liveSource = 'rpc';
      // Reconcile upward — RPC is canonical when it exceeds the
      // cached column. We don't write the column lower (the webhook
      // might be racing and we don't want to flap).
      if (rpc.usdcMicro > usdcMicro) {
        usdcMicro = rpc.usdcMicro;
        const now = new Date();
        await prisma.circleWallet
          .update({
            where: { id: wallet.id },
            data: {
              usdcBalanceMicro: rpc.usdcMicro,
              balanceUpdatedAt: now,
            },
          })
          .catch(err => {
            // Persist failure is non-fatal — we still serve the live
            // value to the caller, just don't update the cache.
            console.warn('[wallet/balance] live persist failed (non-fatal)', {
              walletId: wallet.id,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        updatedAt = now;
      }
    } catch (err) {
      // RPC failure falls back to cached value silently. Caller can
      // retry with ?live=1 again; transient RPC blips shouldn't
      // surface as wallet-not-found.
      console.warn('[wallet/balance] live RPC failed (falling back to cache)', {
        walletId: wallet.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({
    address: wallet.address,
    usdc: usdcMicro.toString(),
    eurc: wallet.eurcBalanceMicro?.toString() ?? '0',
    updatedAt: updatedAt?.toISOString() ?? null,
    source: liveSource,
  });
}
