/**
 * POST /api/dev/complete-org-provisioning
 *
 * Local development only. Mirrors the `organization.created` Clerk webhook
 * path when Clerk cannot reach localhost (no tunnel on /api/webhooks/clerk).
 * Branches on `tenant.primaryChain`:
 *   - 'arc' → provisionTenantWallet (Circle MSCA on Arc)
 *   - 'sol' → provisionTenantSolanaTreasury (Squads V4 + DCWs) + ensureOrgIdentity
 *
 * The Tenant row's primaryChain is whatever the upsert wrote — for orgs
 * coming through the Clerk OrganizationList path (no chain selector), it
 * defaults to 'arc'. To exercise the Solana branch in dev, set the row's
 * primaryChain to 'sol' first via psql or a server action.
 */
import { auth, clerkClient } from '@clerk/nextjs/server';
import { provisionTenantWallet } from '@sendero/circle';
import { provisionTenantSolanaTreasury } from '@sendero/circle/provision-tenant-solana-treasury';
import { prisma } from '@sendero/database';
import { ensureOrgIdentity } from '@sendero/tools/provision-identity';
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

  if (tenant.primaryChain === 'sol') {
    const sol = await provisionTenantSolanaTreasury({
      tenantId: tenant.id,
      clerkOrgId: orgId,
    });
    let identityStatus: string | null = null;
    let identityError: string | null = null;
    try {
      const identity = await ensureOrgIdentity({ tenantId: tenant.id });
      identityStatus = identity.status;
    } catch (err) {
      identityError = err instanceof Error ? err.message : String(err);
      console.warn('[dev/complete-org-provisioning] sol identity failed (non-fatal)', {
        tenantId: tenant.id,
        error: identityError,
      });
    }
    await client.organizations.updateOrganization(orgId, {
      publicMetadata: {
        tenantId: tenant.id,
        primaryChain: 'sol',
        solTreasuryAddress: sol.address,
        onboardingComplete: true,
      },
    });
    console.log('[dev/complete-org-provisioning] sol', {
      orgId,
      tenantId: tenant.id,
      address: sol.address,
      alreadyExisted: sol.alreadyExisted,
      identityStatus,
    });
    return NextResponse.json({
      ok: true,
      chain: 'sol',
      tenantId: tenant.id,
      solTreasuryAddress: sol.address,
      alreadyExisted: sol.alreadyExisted,
      identityStatus,
      identityError,
    });
  }

  const result = await provisionTenantWallet({
    tenantId: tenant.id,
    clerkOrgId: orgId,
  });

  await client.organizations.updateOrganization(orgId, {
    publicMetadata: {
      tenantId: tenant.id,
      primaryChain: 'arc',
      arcWalletAddress: result.address,
      onboardingComplete: true,
    },
  });

  console.log('[dev/complete-org-provisioning] arc', {
    orgId,
    tenantId: tenant.id,
    address: result.address,
  });

  return NextResponse.json({
    ok: true,
    chain: 'arc',
    tenantId: tenant.id,
    arcWalletAddress: result.address,
  });
}
