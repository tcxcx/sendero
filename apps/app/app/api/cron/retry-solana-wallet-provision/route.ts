/**
 * GET /api/cron/retry-solana-wallet-provision
 *
 * Phase 4.x.y — Solana counterpart of `retry-wallet-provision`.
 *
 * Sweeps Sol-primary tenants whose Clerk webhook missed (Circle 5xx,
 * partial outage, mid-deploy crash) and retries
 * `provisionTenantSolanaTreasury` + `ensureOrgIdentity`. After the
 * wallet exists, ensureOrgIdentity writes the intent OnchainIdentity
 * row with the real holder.
 *
 * Same auth + bounding pattern as the Arc sweeper:
 *   - CRON_SECRET bearer check
 *   - 50 candidates per run
 *   - Stamps clerkOrg publicMetadata on success
 *
 * Schedule: every 5 minutes once enabled in apps/app/vercel.json.
 * Auth: CRON_SECRET header match.
 */

import { type NextRequest, NextResponse } from 'next/server';

import { clerkClient } from '@clerk/nextjs/server';
import { provisionTenantSolanaTreasury } from '@sendero/circle/provision-tenant-solana-treasury';
import { prisma } from '@sendero/database';
import { ensureOrgIdentity } from '@sendero/tools/provision-identity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (expected && req.headers.get('authorization') !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Sol-primary tenants WITHOUT a SOL-DEVNET treasury wallet.
  const candidates = await prisma.tenant.findMany({
    where: {
      primaryChain: 'sol',
      circleWallets: {
        none: { kind: 'treasury', chain: { in: ['SOL-DEVNET', 'SOL'] } },
      },
    },
    select: { id: true, clerkOrgId: true },
    take: 50,
  });

  const results: Array<unknown> = [];
  for (const c of candidates) {
    if (!c.clerkOrgId) continue;
    try {
      const wallet = await provisionTenantSolanaTreasury({
        tenantId: c.id,
        clerkOrgId: c.clerkOrgId,
      });
      let identityStatus: string | null = null;
      let identityError: string | null = null;
      try {
        const identity = await ensureOrgIdentity({ tenantId: c.id });
        identityStatus = identity.status;
      } catch (err) {
        identityError = err instanceof Error ? err.message : String(err);
        console.warn('[cron/retry-solana-wallet-provision] identity intent failed', {
          tenantId: c.id,
          error: identityError,
        });
      }

      let clerkUpdated = false;
      let clerkError: string | null = null;
      try {
        const client = await clerkClient();
        await client.organizations.updateOrganization(c.clerkOrgId, {
          publicMetadata: {
            tenantId: c.id,
            primaryChain: 'sol',
            solTreasuryAddress: wallet.address,
            onboardingComplete: true,
          },
        });
        clerkUpdated = true;
      } catch (err) {
        clerkError = err instanceof Error ? err.message : String(err);
      }
      results.push({
        tenantId: c.id,
        outcome: 'provisioned',
        alreadyExisted: wallet.alreadyExisted,
        address: wallet.address,
        identityStatus,
        identityError,
        clerkUpdated,
        clerkError,
      });
    } catch (err) {
      results.push({
        tenantId: c.id,
        outcome: 'failed',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({ candidateCount: candidates.length, results });
}
