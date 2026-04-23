/**
 * POST /api/dev/complete-org-provisioning
 *
 * Local development only. Mirrors the `organization.created` Clerk webhook path
 * when Clerk cannot reach localhost (no tunnel on /api/webhooks/clerk).
 * Upserts Tenant, provisions Circle wallet, stamps org publicMetadata.
 */
import { auth, clerkClient } from '@clerk/nextjs/server';
import { provisionTenantWallet } from '@sendero/circle';
import { prisma } from '@sendero/database';
import { type NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const { userId, orgId } = await auth();
  if (!userId || !orgId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const client = await clerkClient();
  const org = await client.organizations.getOrganization({ organizationId: orgId });
  const name = org.name;
  const slug = org.slug ?? orgId;

  const tenant = await prisma.tenant.upsert({
    where: { clerkOrgId: orgId },
    create: {
      clerkOrgId: orgId,
      slug,
      displayName: name,
      billingTier: 'free',
    },
    update: { slug, displayName: name },
  });

  const result = await provisionTenantWallet({
    tenantId: tenant.id,
    clerkOrgId: orgId,
  });

  await client.organizations.updateOrganization(orgId, {
    publicMetadata: {
      tenantId: tenant.id,
      arcWalletAddress: result.address,
      onboardingComplete: true,
    },
  });

  console.log('[dev/complete-org-provisioning]', {
    orgId,
    tenantId: tenant.id,
    address: result.address,
  });

  return NextResponse.json({
    ok: true,
    tenantId: tenant.id,
    arcWalletAddress: result.address,
  });
}
