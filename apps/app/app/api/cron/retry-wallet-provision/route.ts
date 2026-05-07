/**
 * GET /api/cron/retry-wallet-provision
 *
 * Phase-11c1 Epic 8 — sweeper that fills gaps left when the synchronous
 * `organization.created` Clerk webhook couldn't provision a Circle
 * wallet (transient Circle API failure, partial outage, etc.).
 *
 * Picks up Tenants that have a `clerkOrgId` but no `CircleWallet` row,
 * retries `provisionTenantWallet`, mints the workspace on-chain identity,
 * and stamps `org.publicMetadata` with { tenantId, arcWalletAddress,
 * onboardingComplete: true } when the Clerk org still exists.
 *
 * Scheduled every 5 minutes via apps/app/vercel.json. Bounded to 50
 * candidates per run to stay inside maxDuration.
 *
 * Auth: CRON_SECRET header match (Vercel injects this automatically).
 */

import { type NextRequest, NextResponse } from 'next/server';

import { clerkClient } from '@clerk/nextjs/server';
import { provisionTenantWallet } from '@sendero/circle';
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

  // Candidates: Tenants with a clerkOrgId but no treasury wallet yet.
  // Gateway operations wallets may already exist; treasury is still
  // required for tenant settlement and operator wallet views.
  //
  // Phase 3 — exclude Solana-primary tenants. The Arc Circle path
  // doesn't apply; Solana provisioning lands in Phase 3.x via a
  // separate sweeper. Without this filter the cron would burn Circle
  // API calls retrying tenants we never intend to put on Arc.
  const candidates = await prisma.tenant.findMany({
    where: {
      circleWallets: { none: { kind: 'treasury' } },
      primaryChain: 'arc',
    },
    select: { id: true, clerkOrgId: true },
    take: 50,
  });

  const results: Array<unknown> = [];
  for (const c of candidates) {
    if (!c.clerkOrgId) continue;
    try {
      const result = await provisionTenantWallet({
        tenantId: c.id,
        clerkOrgId: c.clerkOrgId,
      });
      let clerkMetadataUpdated = false;
      let clerkMetadataError: string | null = null;
      try {
        const client = await clerkClient();
        await client.organizations.updateOrganization(c.clerkOrgId, {
          publicMetadata: {
            tenantId: c.id,
            primaryChain: 'arc',
            arcWalletAddress: result.address,
            onboardingComplete: true,
          },
        });
        clerkMetadataUpdated = true;
      } catch (err) {
        clerkMetadataError = err instanceof Error ? err.message : String(err);
        console.warn('[cron/retry-wallet-provision] Clerk metadata update failed', {
          tenantId: c.id,
          clerkOrgId: c.clerkOrgId,
          error: clerkMetadataError,
        });
      }
      const identity = await ensureOrgIdentity({ tenantId: c.id });
      results.push({
        tenantId: c.id,
        outcome: 'provisioned',
        alreadyExisted: result.alreadyExisted,
        clerkMetadataUpdated,
        clerkMetadataError,
        identityStatus: identity.status,
        agentId: identity.agentId,
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
