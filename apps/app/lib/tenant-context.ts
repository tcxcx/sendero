import { auth } from '@clerk/nextjs/server';
import { prisma, type Tenant, type ChainKind } from '@sendero/database';
import { redirect } from 'next/navigation';

export async function requireCurrentTenant(): Promise<{
  tenant: Tenant;
  orgId: string;
  userId: string;
}> {
  const { userId, orgId } = await auth();
  if (!userId) redirect('/sign-in');
  if (!orgId) redirect('/onboarding');

  const tenant = await prisma.tenant.findUnique({ where: { clerkOrgId: orgId } });
  if (!tenant) redirect('/onboarding');

  return { tenant, orgId, userId };
}

/**
 * Phase 3 — canonical resolver for the tenant's primary chain.
 *
 * Every wallet/escrow/NFT provisioning surface should branch on this
 * value rather than defaulting to Arc unconditionally. Returns
 * `'arc'` for missing rows so legacy callers see the same default
 * Prisma applies on insert (`@default(arc)`).
 *
 * Why a dedicated resolver: the field is read on the hot path of
 * onboarding, the Clerk webhook, the wallet-retry cron, and the
 * org-settings UI. Centralizing here means a Phase 3.x switch to
 * read primaryChain from a different source (e.g. enterprise plan
 * override) only edits one file.
 */
export async function getTenantPrimaryChain(tenantId: string): Promise<ChainKind> {
  const row = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { primaryChain: true },
  });
  return row?.primaryChain ?? 'arc';
}
