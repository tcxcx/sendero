import { z } from 'zod';

import { syncWalletBalance } from '@sendero/circle/balance-sync';
import { getTreasuryBalances } from '@sendero/circle/wallets';
import { prisma } from '@sendero/database';

import type { ToolDef, ToolContext } from './types';

/**
 * `check_treasury` — return the caller tenant's on-chain USDC + EURC
 * balance on Arc Testnet.
 *
 * Two modes:
 *   - `verify: false` (default): reads the cached `CircleWallet`
 *     columns. Bounded to ~5 min stale by the
 *     `/api/cron/reconcile-wallet-balances` cron + the live Circle
 *     webhook fan-out. Free, sub-50ms.
 *   - `verify: true`: round-trips Circle's `getWalletTokenBalance`
 *     before returning, writes the cache, fires `pg_notify` so any
 *     active `/dashboard` WalletDropdown picks up the new value.
 *     Adds ~1-2s and one Circle API call.
 *
 * Tenant resolution comes from `ctx.traveler.tenantId` (forwarded
 * from the dispatch route's resolved API key or the operator session).
 * Never reads tenantId from input — that would let a prompt-injected
 * agent peek across tenants.
 *
 * When the tool runs without a tenant context (rare: smoke tests, ad-hoc
 * scripts), it falls back to the legacy platform treasury via
 * `getTreasuryBalances()` so existing demo flows keep working. The
 * response carries `scope: 'platform'` in that case so callers can
 * tell the two apart.
 */

const inputSchema = z.object({
  verify: z
    .boolean()
    .default(false)
    .describe(
      'Round-trip Circle live before returning. Slower (~1-2s) but ground truth. Default false reads cached value (max ~5 min stale).'
    ),
});

interface TenantTreasuryResult {
  scope: 'tenant';
  tenantId: string;
  address: string;
  usdc: { micro: string; display: string };
  eurc: { micro: string; display: string };
  balanceUpdatedAt: string | null;
  source: 'cache' | 'live';
}

interface PlatformTreasuryResult {
  scope: 'platform';
  // Legacy shape for back-compat with demo-workflow callers.
  balances: Awaited<ReturnType<typeof getTreasuryBalances>>;
}

type CheckTreasuryResult = TenantTreasuryResult | PlatformTreasuryResult;

function microToDisplay(micro: bigint): string {
  // 6-decimal USDC/EURC. Format with up to 6 decimals trimmed of
  // trailing zeros for readability ("110" not "110.000000").
  const whole = micro / 1_000_000n;
  const frac = micro % 1_000_000n;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(6, '0').replace(/0+$/, '')}`;
}

export const checkTreasuryTool: ToolDef<{ verify?: boolean }, CheckTreasuryResult> = {
  name: 'check_treasury',
  description:
    "Check the caller tenant's USDC + EURC balance on Arc Testnet. Reads the cached value (max ~5 min stale) by default. Pass `verify: true` to round-trip Circle live before returning — use that before settle-bearing decisions.",
  inputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      verify: {
        type: 'boolean',
        default: false,
        description: 'Round-trip Circle live before returning. Slower (~1-2s) but ground truth.',
      },
    },
  },
  async handler(input, ctx?: ToolContext): Promise<CheckTreasuryResult> {
    const tenantId = ctx?.traveler?.tenantId ?? null;
    const verify = input.verify ?? false;

    if (!tenantId) {
      // No tenant context — two cases to disambiguate:
      //   (a) Smoke test / ad-hoc script — ctx is undefined or `{}`. Fall
      //       back to the platform treasury so existing demo flows keep
      //       working.
      //   (b) Wiring bug — ctx exists, has `caller` set, but `traveler`
      //       wasn't forwarded. Fail loudly instead of leaking the
      //       platform balance to an authenticated caller. This is the
      //       cross-tenant-leak defense.
      const isSmokeTest = !ctx || Object.keys(ctx).length === 0;
      if (!isSmokeTest) {
        throw new Error(
          'check_treasury: ctx.traveler.tenantId is required when ctx is set. The caller surface forgot to forward tenant context — refusing to leak the platform treasury balance. Wire `traveler: { tenantId }` into the tool context, or call the tool with no ctx to get the legacy platform-treasury smoke-test response.'
        );
      }
      const balances = await getTreasuryBalances();
      return { scope: 'platform', balances };
    }

    const wallet = await prisma.circleWallet.findFirst({
      where: { tenantId, kind: 'treasury' },
      select: {
        circleWalletId: true,
        address: true,
        usdcBalanceMicro: true,
        eurcBalanceMicro: true,
        balanceUpdatedAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    if (!wallet) {
      throw new Error(
        `No CircleWallet for tenant ${tenantId}. Provisioning may still be in flight — wait for the org-creation webhook to finish, or hit /api/tenant/wallet/sync.`
      );
    }

    if (verify && wallet.circleWalletId) {
      const fresh = await syncWalletBalance(
        {
          updateByCircleId: async (id, patch) => {
            await prisma.circleWallet.updateMany({
              where: { circleWalletId: id },
              data: patch,
            });
          },
        },
        wallet.circleWalletId
      );

      // Best-effort fan-out so any open SSE stream picks up the fresh
      // value without waiting for the next webhook or cron tick.
      const payload = JSON.stringify({
        address: wallet.address,
        usdc: fresh.usdcMicro.toString(),
        eurc: fresh.eurcMicro.toString(),
        updatedAt: fresh.observedAt.toISOString(),
      });
      await prisma.$executeRaw`SELECT pg_notify('wallet_balance', ${payload})`.catch(() => null);

      return {
        scope: 'tenant',
        tenantId,
        address: wallet.address,
        usdc: { micro: fresh.usdcMicro.toString(), display: microToDisplay(fresh.usdcMicro) },
        eurc: { micro: fresh.eurcMicro.toString(), display: microToDisplay(fresh.eurcMicro) },
        balanceUpdatedAt: fresh.observedAt.toISOString(),
        source: 'live',
      };
    }

    const usdcMicro = wallet.usdcBalanceMicro ?? 0n;
    const eurcMicro = wallet.eurcBalanceMicro ?? 0n;
    return {
      scope: 'tenant',
      tenantId,
      address: wallet.address,
      usdc: { micro: usdcMicro.toString(), display: microToDisplay(usdcMicro) },
      eurc: { micro: eurcMicro.toString(), display: microToDisplay(eurcMicro) },
      balanceUpdatedAt: wallet.balanceUpdatedAt?.toISOString() ?? null,
      source: 'cache',
    };
  },
};
