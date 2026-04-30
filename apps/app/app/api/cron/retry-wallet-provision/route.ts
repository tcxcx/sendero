/**
 * GET /api/cron/retry-wallet-provision
 *
 * Phase-11c1 Epic 8 — sweeper that fills gaps left when the synchronous
 * `organization.created` Clerk webhook couldn't provision a Circle
 * wallet (transient Circle API failure, partial outage, etc.).
 *
 * Picks up Tenants that have a `clerkOrgId` but no `CircleWallet` row,
 * retries `provisionTenantWallet`, and on success stamps
 * `org.publicMetadata` with { tenantId, arcWalletAddress,
 * onboardingComplete: true } so middleware session claims flip.
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
  const candidates = await prisma.tenant.findMany({
    where: {
      circleWallets: { none: { kind: 'treasury' } },
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
      const client = await clerkClient();
      await client.organizations.updateOrganization(c.clerkOrgId, {
        publicMetadata: {
          tenantId: c.id,
          arcWalletAddress: result.address,
          onboardingComplete: true,
        },
      });
      results.push({
        tenantId: c.id,
        outcome: 'provisioned',
        alreadyExisted: result.alreadyExisted,
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
