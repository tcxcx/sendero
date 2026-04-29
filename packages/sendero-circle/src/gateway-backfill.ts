/**
 * Multi-chain wallet backfill — Phase 2 generalization.
 *
 * Two helpers that diff "required chains" (from @sendero/env/chains)
 * against the tenant's existing wallet rows and provision only what's
 * missing. Both are idempotent + safe to call from:
 *
 *   - The Clerk `organization.created` webhook (initial provisioning)
 *   - The login backfill hook in apps/app/app/(app)/layout.tsx
 *   - The `/api/cron/provision-gateway` sweeper
 *
 * Adding a chain is a one-line change to `getTenantOperationsChains()`
 * — every existing tenant gets the new chain on next login OR within
 * 30 minutes (cron schedule), whichever comes first.
 *
 * Phase 2 chain set is still ARC-only by configuration; the
 * abstraction is what Phase 3 + Phase 4 widen.
 */

import { getTenantTreasuryChains, getTenantOperationsChains } from '@sendero/env/chains';
import { prisma } from '@sendero/database';
import { provisionTenantWallet } from './provision-tenant-wallet';
import { provisionTenantOpsDcw } from './gateway-ops-wallet';

export interface BackfillTenantArgs {
  tenantId: string;
  clerkOrgId: string;
}

export interface BackfillResult {
  /** Chains that were already provisioned. No SDK calls made. */
  existing: string[];
  /** Chains we successfully provisioned. SDK calls made. */
  created: string[];
  /** Chains that failed to provision. Caller logs / alerts. */
  failed: Array<{ chain: string; error: string }>;
}

// ── Treasury backfill ────────────────────────────────────────────────

/**
 * Ensure every chain in `getTenantTreasuryChains()` has a treasury row
 * for the tenant. Phase 2 = ARC only; Phase 3+ may widen if settlement
 * moves off Arc.
 *
 * Idempotent on (tenantId, kind='treasury', chain) thanks to the
 * unique constraint added in Phase 2 P2.2 migration. Concurrent
 * callers race on the constraint — losers see P2002 and the helper
 * absorbs that as "already exists, no-op."
 */
export async function backfillTenantTreasuryWallets(
  args: BackfillTenantArgs
): Promise<BackfillResult> {
  const required = getTenantTreasuryChains();

  const existingRows = await prisma.circleWallet.findMany({
    where: { tenantId: args.tenantId, kind: 'treasury' },
    select: { chain: true },
  });
  const existingChains = new Set(existingRows.map(r => r.chain));

  const created: string[] = [];
  const failed: BackfillResult['failed'] = [];

  for (const chain of required) {
    if (existingChains.has(chain)) continue;
    try {
      // Phase 2 note: provisionTenantWallet currently hardcodes ARC-TESTNET
      // internally. When Phase 3 adds AVAX, that function will accept a
      // `chain` parameter or be replaced by a generic per-chain helper.
      // For now this loop only runs once (Arc) so the hardcode is fine.
      if (chain !== 'ARC-TESTNET' && chain !== 'ARC') {
        failed.push({
          chain,
          error: `provisionTenantWallet does not yet support chain=${chain} — extend it in Phase 3+`,
        });
        continue;
      }
      await provisionTenantWallet({
        tenantId: args.tenantId,
        clerkOrgId: args.clerkOrgId,
      });
      created.push(chain);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // P2002 = unique violation = another caller won. Treat as existing.
      if (msg.includes('P2002') || msg.includes('Unique constraint')) {
        continue;
      }
      failed.push({ chain, error: msg });
    }
  }

  return {
    existing: [...existingChains],
    created,
    failed,
  };
}

// ── Operations DCW backfill ──────────────────────────────────────────

/**
 * Ensure every chain in `getTenantOperationsChains()` has an ops DCW
 * row for the tenant. Phase 2 = ARC only; Phase 3 adds AVAX-FUJI;
 * Phase 4 adds SOL-DEVNET (which will branch via a Solana-specific
 * provisioning path inside `provisionTenantOpsDcw` since Solana DCWs
 * need different account-type wiring).
 *
 * Idempotent on (tenantId, kind='operations', chain) via the Phase 2
 * unique constraint. Race-safe: P2002 is absorbed as no-op.
 */
export async function backfillTenantOpsDcws(
  args: BackfillTenantArgs
): Promise<BackfillResult> {
  const required = getTenantOperationsChains();

  const existingRows = await prisma.circleWallet.findMany({
    where: { tenantId: args.tenantId, kind: 'operations' },
    select: { chain: true },
  });
  const existingChains = new Set(existingRows.map(r => r.chain));

  const created: string[] = [];
  const failed: BackfillResult['failed'] = [];

  for (const chain of required) {
    if (existingChains.has(chain)) continue;
    try {
      await provisionTenantOpsDcw({
        tenantId: args.tenantId,
        clerkOrgId: args.clerkOrgId,
        chain,
      });
      created.push(chain);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('P2002') || msg.includes('Unique constraint')) continue;
      failed.push({ chain, error: msg });
    }
  }

  return {
    existing: [...existingChains],
    created,
    failed,
  };
}

// ── Combined backfill ────────────────────────────────────────────────

export interface FullBackfillResult {
  treasury: BackfillResult;
  operations: BackfillResult;
}

/**
 * Run both treasury + operations backfill in parallel. The login hook
 * + provision-gateway cron use this. Webhook `organization.created`
 * uses the per-purpose helpers because it sequences with Gateway
 * config provisioning (which depends on the signer + ops DCW being
 * present first).
 */
export async function backfillTenantWallets(
  args: BackfillTenantArgs
): Promise<FullBackfillResult> {
  const [treasury, operations] = await Promise.all([
    backfillTenantTreasuryWallets(args),
    backfillTenantOpsDcws(args),
  ]);
  return { treasury, operations };
}
