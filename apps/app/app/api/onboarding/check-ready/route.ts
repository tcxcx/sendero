/**
 * GET /api/onboarding/check-ready
 *
 * Single source of truth the client polls to decide whether
 * /onboarding should hand off to /dashboard. Verifies BOTH:
 *
 *   1. Clerk session has a current org
 *   2. A matching Tenant row exists in our DB
 *
 * The /onboarding page used to push to /dashboard the moment Clerk's
 * `onboardingComplete = true` flag flipped. That broke when the flag
 * was stale (cached JWT, prior session) but the DB didn't have the
 * Tenant row: /dashboard's requireCurrentTenant() server-redirected
 * back to /onboarding, and the cycle flickered the browser.
 *
 * Gating the client-side push on this endpoint instead of the Clerk
 * flag alone breaks that loop. When `ready: false`, the client can
 * re-trigger provisioning instead of pushing to /dashboard.
 */

import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

import { prisma } from '@sendero/database';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const { orgId } = await auth();
  if (!orgId) {
    return NextResponse.json({ ready: false, reason: 'no_org' });
  }
  const tenant = await prisma.tenant.findUnique({
    where: { clerkOrgId: orgId },
    select: { id: true, primaryChain: true, arcAddress: true },
  });
  if (!tenant) {
    return NextResponse.json({ ready: false, reason: 'no_tenant', orgId });
  }
  return NextResponse.json({
    ready: true,
    tenantId: tenant.id,
    primaryChain: tenant.primaryChain,
  });
}
