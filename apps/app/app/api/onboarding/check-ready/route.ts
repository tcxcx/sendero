/**
 * GET /api/onboarding/check-ready
 *
 * Source of truth the wait screen polls. Returns three things:
 *
 *   1. `ready` — boolean. True when Clerk org has a current org AND a
 *      matching Tenant row exists AND the chain-appropriate wallet
 *      address is set. The client uses this to decide push-to-dashboard.
 *
 *   2. `reason` — string, present when `ready` is false. Lets the client
 *      surface a meaningful inline message and decide whether to retry
 *      provisioning vs. wait.
 *
 *   3. `progress` — ProvisioningState | null. Stamped by
 *      `runTenantProvisioning` into `Tenant.metadata.provisioning`. The
 *      wait screen renders per-stage dots from this blob.
 *
 * The earlier flicker loop happened when the Clerk session JWT carried
 * a stale `onboardingComplete = true` but the DB had no matching
 * Tenant row OR no wallet stamped. We require both before pushing.
 */

import { NextResponse } from 'next/server';

import { auth } from '@clerk/nextjs/server';
import { prisma } from '@sendero/database';

import { readProvisioning } from '@/lib/provisioning-progress';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const { orgId, sessionClaims } = await auth();
  if (!orgId) {
    return NextResponse.json({ ready: false, reason: 'no_org', progress: null });
  }
  const tenant = await prisma.tenant.findUnique({
    where: { clerkOrgId: orgId },
    select: { id: true, primaryChain: true, arcAddress: true, metadata: true },
  });
  if (!tenant) {
    return NextResponse.json({ ready: false, reason: 'no_tenant', orgId, progress: null });
  }

  const progress = await readProvisioning(tenant.id);

  // Readiness derivation. Two independent truth sources — we accept
  // either, because Clerk's session JWT refresh lags ~60s behind the
  // org metadata write and the user shouldn't sit on /onboarding while
  // we wait for the JWT to roll over.
  //
  //   1. `Tenant.metadata.provisioning.currentStage === 'done'` — DB-
  //      stamped at the end of runTenantProvisioning(). Source of truth.
  //   2. `sessionClaims.org_metadata.solTreasuryAddress` /
  //      `tenant.arcAddress` — the older session-driven path, kept for
  //      back-compat with tenants provisioned before the state-machine
  //      landed (no `provisioning` blob in metadata).
  const orgMeta = (sessionClaims?.org_metadata ?? {}) as { solTreasuryAddress?: string };
  const sessionWalletReady =
    tenant.primaryChain === 'sol'
      ? Boolean(orgMeta.solTreasuryAddress)
      : Boolean(tenant.arcAddress);
  const stateMachineReady = progress?.currentStage === 'done';

  const walletReady = stateMachineReady || sessionWalletReady;

  if (!walletReady) {
    return NextResponse.json({
      ready: false,
      reason: 'no_wallet',
      tenantId: tenant.id,
      primaryChain: tenant.primaryChain,
      progress,
    });
  }

  return NextResponse.json({
    ready: true,
    tenantId: tenant.id,
    primaryChain: tenant.primaryChain,
    progress,
  });
}
