/**
 * Login-time Gateway backfill — Phase 2 P2.6.
 *
 * Triggered from `apps/app/app/(app)/dashboard/layout.tsx` via Next.js
 * `after()` so it runs post-response and doesn't delay page render.
 * Idempotent: backfill helpers diff required-vs-existing chains and
 * only call Circle SDK for what's missing.
 *
 * What this catches:
 *   - Tenants whose Clerk `organization.created` provisioning failed
 *     non-fatally (Circle hiccup, missing env, partial state).
 *   - Tenants that existed before Phase 1 launched and haven't yet
 *     hit the /api/cron/provision-gateway sweeper.
 *   - Tenants that pre-date a Phase 3+ chain addition (AVAX, ARB,
 *     SOL) — adding a chain to getTenantOperationsChains() means
 *     every existing tenant lights up on next login.
 *
 * Cadence: runs on every dashboard navigation. If everything is
 * already provisioned, the cost is two Prisma findMany calls (cheap).
 * No throttle necessary.
 *
 * Failure handling: pure best-effort. Any error is logged and
 * swallowed — the page already rendered, the user shouldn't see a
 * post-render failure they can't act on. The cron + next-login
 * hook backstop.
 */

import { backfillTenantWallets } from '@sendero/circle/gateway-backfill';
import { getOrCreateGatewaySigner, getTenantSolanaSigner } from '@sendero/circle/gateway-signer';
import { prisma } from '@sendero/database';
import { GATEWAY_DOMAIN_BY_CHAIN, getTenantOperationsChains } from '@sendero/env/chains';

export interface BackfillTenantGatewayPostLoginArgs {
  tenantId: string;
  clerkOrgId: string;
}

export async function backfillTenantGatewayPostLogin(
  args: BackfillTenantGatewayPostLoginArgs
): Promise<void> {
  try {
    // Step 1: ensure signer exists (race-safe + idempotent).
    const signer = await getOrCreateGatewaySigner(args.tenantId);

    // Step 2: backfill treasury + ops DCWs against the active chain
    // config. Race-safe via Phase 2 unique constraint.
    const result = await backfillTenantWallets({
      tenantId: args.tenantId,
      clerkOrgId: args.clerkOrgId,
    });

    // Step 3: ensure TenantGatewayConfig exists with the latest
    // enabled-domains list. Upsert so a config that pre-dates a chain
    // addition gets refreshed when the user logs in again.
    const requiredOpsChains = getTenantOperationsChains();
    const actualOpsWallets = await prisma.circleWallet.findMany({
      where: {
        tenantId: args.tenantId,
        kind: 'operations',
        chain: { in: [...requiredOpsChains] },
      },
      select: { chain: true },
    });
    const enabledDomains = mergeUniqueSorted(
      undefined,
      actualOpsWallets
        .map(w => GATEWAY_DOMAIN_BY_CHAIN[w.chain])
        .filter((domain): domain is number => typeof domain === 'number')
    );
    // Phase 4.5: prefer the self-custody Sol signer (which can actually
    // sign App Kit's gatewayBurn for Sol-source unified spend) over the
    // legacy Circle DCW operations wallet. The DCW falls back as the
    // depositor pointer only when no self-custody signer is provisioned
    // yet — that fallback also pins the address until Phase 4.5 lights
    // up for that tenant.
    const [solSelfCustody, solanaOpsWallet] = await Promise.all([
      getTenantSolanaSigner(args.tenantId),
      prisma.circleWallet.findFirst({
        where: {
          tenantId: args.tenantId,
          kind: 'operations',
          chain: { in: ['SOL-DEVNET', 'SOL'] },
        },
        select: { address: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    const solanaDepositor = solSelfCustody?.address ?? solanaOpsWallet?.address ?? null;
    await prisma.tenantGatewayConfig.upsert({
      where: { tenantId: args.tenantId },
      create: {
        tenantId: args.tenantId,
        evmDepositorAddress: signer.address,
        solanaDepositorAddress: solanaDepositor,
        enabledDomains,
      },
      update: {
        evmDepositorAddress: signer.address,
        solanaDepositorAddress: solanaDepositor ?? undefined,
        // Only widen, never narrow. Operators can disable chains
        // explicitly via a future admin action; the login hook should
        // not retract a chain a tenant has been transacting on.
        enabledDomains: { set: mergeUniqueSorted(undefined, enabledDomains) },
      },
    });

    if (
      result.treasury.created.length > 0 ||
      result.operations.created.length > 0 ||
      result.treasury.failed.length > 0 ||
      result.operations.failed.length > 0
    ) {
      console.log('[gateway-backfill-hook] result', {
        tenantId: args.tenantId,
        treasury: {
          created: result.treasury.created,
          failed: result.treasury.failed,
        },
        operations: {
          created: result.operations.created,
          failed: result.operations.failed,
        },
      });
    }
  } catch (err) {
    console.warn('[gateway-backfill-hook] crashed (non-fatal)', {
      tenantId: args.tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Union of two domain ID sets, deduped, sorted ascending. Used for
 * the upsert's enabledDomains so adding chains is monotonic.
 *
 * `existing` is a placeholder for the future when we read the row
 * before upserting — Phase 2 we don't yet, so callers pass `undefined`
 * which means "use the new set as-is."
 */
function mergeUniqueSorted(existing: number[] | undefined, incoming: number[]): number[] {
  const merged = new Set<number>(existing ?? []);
  for (const d of incoming) merged.add(d);
  return [...merged].sort((a, b) => a - b);
}
