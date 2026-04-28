/**
 * POST /api/tenant/wallet/sync
 *
 * On-demand resync of the caller's tenant treasury balance. Calls the
 * same syncWalletBalance() the webhook + reconciliation cron use, then
 * fires pg_notify('wallet_balance') so the active SSE stream pushes the
 * new value to the WalletDropdown without waiting for the next webhook
 * or cron tick.
 *
 * Auth: Clerk session, scoped to the active org. The endpoint name
 * matches the path the confirm_booking error message already promises
 * ("hit /api/tenant/wallet/sync to force a re-provision").
 *
 * Returns 404 (not 403) when the org has no CircleWallet — this is
 * the same code path as "wallet doesn't exist", we never leak existence
 * across tenants.
 */

import { type NextRequest, NextResponse } from 'next/server';

import { auth } from '@clerk/nextjs/server';
import { syncWalletBalance } from '@sendero/circle/balance-sync';
import { prisma } from '@sendero/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(_req: NextRequest) {
  const { orgId } = await auth();
  if (!orgId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const tenant = await prisma.tenant.findUnique({
    where: { clerkOrgId: orgId },
    select: {
      id: true,
      circleWallets: {
        where: { circleWalletId: { not: null } },
        select: { id: true, circleWalletId: true, address: true },
        take: 1,
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  const wallet = tenant?.circleWallets[0];
  if (!wallet?.circleWalletId) {
    return NextResponse.json({ error: 'wallet_not_found' }, { status: 404 });
  }

  try {
    const balances = await syncWalletBalance(
      {
        updateByCircleId: async (id, patch) => {
          await prisma.circleWallet.updateMany({ where: { circleWalletId: id }, data: patch });
        },
      },
      wallet.circleWalletId
    );

    const payload = JSON.stringify({
      address: wallet.address,
      usdc: balances.usdcMicro.toString(),
      eurc: balances.eurcMicro.toString(),
      updatedAt: balances.observedAt.toISOString(),
    });
    await prisma.$executeRaw`SELECT pg_notify('wallet_balance', ${payload})`.catch(() => null);

    return NextResponse.json({
      ok: true,
      address: wallet.address,
      usdc: balances.usdcMicro.toString(),
      eurc: balances.eurcMicro.toString(),
      updatedAt: balances.observedAt.toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[tenant/wallet/sync] failed', {
      circleWalletId: wallet.circleWalletId,
      message,
    });
    return NextResponse.json({ error: 'sync_failed', message }, { status: 500 });
  }
}
