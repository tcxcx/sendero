/**
 * GET /api/cron/reconcile-wallet-balances
 *
 * Backstop for the Circle webhook. Polls every CircleWallet (tenant
 * treasuries) + every Wallet with a circleWalletId (traveler DCWs) and
 * calls syncWalletBalance — same path the webhook uses, so cached
 * columns + pg_notify(wallet_balance) stay identical.
 *
 * Why: webhooks drop. The receiver path was 100% reliable for months
 * yet WebhookEvent.provider='circle' had zero rows because the
 * subscription wasn't registered for the wallet-sync URL. With this
 * cron, the cache cannot stay stale longer than the schedule interval
 * regardless of webhook delivery.
 *
 * Schedule: every 5 minutes (apps/app/vercel.json). Bounded to 200
 * wallets per run to stay inside maxDuration; treasury wallets total
 * comfortably below that today.
 *
 * Auth: CRON_SECRET Bearer (Vercel injects).
 */

import { type NextRequest, NextResponse } from 'next/server';

import { syncWalletBalance } from '@sendero/circle/balance-sync';
import { prisma } from '@sendero/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const PER_RUN_LIMIT = 200;
const SYNC_CONCURRENCY = 3;

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRateLimited(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes('429');
}

async function withRateLimitRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isRateLimited(err)) throw err;
    await sleep(1_500);
    return fn();
  }
}

async function runPool<T>(
  items: T[],
  worker: (item: T, index: number) => Promise<void>
): Promise<Array<PromiseSettledResult<void>>> {
  const results: Array<PromiseSettledResult<void>> = new Array(items.length);
  let cursor = 0;

  async function next() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        await worker(items[index], index);
        results[index] = { status: 'fulfilled', value: undefined };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
      await sleep(150);
    }
  }

  await Promise.all(Array.from({ length: Math.min(SYNC_CONCURRENCY, items.length) }, () => next()));
  return results;
}

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (expected && req.headers.get('authorization') !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();

  const [tenantWallets, travelerWallets] = await Promise.all([
    prisma.circleWallet.findMany({
      where: { circleWalletId: { not: null } },
      select: { id: true, circleWalletId: true, address: true },
      orderBy: { balanceUpdatedAt: { sort: 'asc', nulls: 'first' } },
      take: PER_RUN_LIMIT,
    }),
    prisma.wallet.findMany({
      where: { circleWalletId: { not: null }, provisioner: 'dcw' },
      select: { id: true, circleWalletId: true, address: true },
      orderBy: { lastSeenAt: { sort: 'asc', nulls: 'first' } },
      take: PER_RUN_LIMIT,
    }),
  ]);

  const tenantStore = {
    updateByCircleId: async (
      id: string,
      patch: { usdcBalanceMicro: bigint; eurcBalanceMicro: bigint; balanceUpdatedAt: Date }
    ) => {
      await prisma.circleWallet.updateMany({ where: { circleWalletId: id }, data: patch });
    },
  };

  const travelerStore = {
    updateByCircleId: async (id: string, patch: { usdcBalanceMicro: bigint }) => {
      // Wallet model caches Gateway USDC under gatewayBalanceMicro; we
      // mirror the on-chain USDC there so the dropdown reads one column
      // regardless of provisioner. EURC isn't surfaced for travelers yet.
      await prisma.wallet.updateMany({
        where: { circleWalletId: id },
        data: { gatewayBalanceMicro: patch.usdcBalanceMicro, lastSeenAt: new Date() },
      });
    },
  };

  let syncedTenants = 0;
  let syncedTravelers = 0;
  let failed = 0;

  const tenantResults = await runPool(tenantWallets, async w => {
    if (!w.circleWalletId) return;
    const balances = await withRateLimitRetry(() =>
      syncWalletBalance(tenantStore, w.circleWalletId)
    );
    const payload = JSON.stringify({
      address: w.address,
      usdc: balances.usdcMicro.toString(),
      eurc: balances.eurcMicro.toString(),
      updatedAt: balances.observedAt.toISOString(),
    });
    await prisma.$executeRaw`SELECT pg_notify('wallet_balance', ${payload})`.catch(() => null);
  });
  tenantResults.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      syncedTenants += 1;
    } else {
      failed += 1;
      // Interpolate ctx into the message — Next's dev logger only
      // stringifies the first arg, so a structured object becomes `{}`
      // in logs and the diagnostic is lost. Same gotcha bit us on the
      // Circle webhook gate; same fix here.
      console.warn(
        `[cron/reconcile-wallet-balances] tenant sync failed ${JSON.stringify({
          circleWalletId: tenantWallets[i].circleWalletId,
          err: r.reason instanceof Error ? r.reason.message : String(r.reason),
        })}`
      );
    }
  });

  const travelerResults = await runPool(travelerWallets, async w => {
    if (!w.circleWalletId) return;
    // We pass our wallet-row-store but reuse the same fetch so the
    // Circle round-trip shape stays identical to the webhook path.
    await withRateLimitRetry(() =>
      syncWalletBalance(
        {
          updateByCircleId: async (id, patch) => travelerStore.updateByCircleId(id, patch),
        },
        w.circleWalletId
      )
    );
  });
  travelerResults.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      syncedTravelers += 1;
    } else {
      failed += 1;
      console.warn(
        `[cron/reconcile-wallet-balances] traveler sync failed ${JSON.stringify({
          circleWalletId: travelerWallets[i].circleWalletId,
          err: r.reason instanceof Error ? r.reason.message : String(r.reason),
        })}`
      );
    }
  });

  return NextResponse.json({
    ok: true,
    syncedTenants,
    syncedTravelers,
    failed,
    durationMs: Date.now() - startedAt,
  });
}
