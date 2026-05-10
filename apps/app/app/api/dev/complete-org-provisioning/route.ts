/**
 * POST /api/dev/complete-org-provisioning
 *
 * Local development only. Mirrors the `organization.created` Clerk webhook
 * path when Clerk cannot reach localhost (no tunnel on /api/webhooks/clerk),
 * AND serves as the deploy endpoint for the chain-select onboarding step.
 *
 * Body: `{ primaryChain?: 'sol' | 'arc' }` — optional, defaults to 'sol'
 * (per the onboarding spec — Sendero is Solana-first now). The Tenant row
 * is upserted with the chosen chain BEFORE branching, so the user's
 * selection is what drives provisioning regardless of any prior default.
 *
 * Branches on `tenant.primaryChain` (post-upsert):
 *   - 'arc' → provisionTenantWallet (Circle MSCA on Arc) + ensureOrgIdentity
 *   - 'sol' → provisionTenantSolanaTreasury (Squads V4 + DCWs) + ensureOrgIdentity
 */
import { auth, clerkClient } from '@clerk/nextjs/server';
import { provisionTenantWallet } from '@sendero/circle';
import { provisionTenantSolanaTreasury } from '@sendero/circle/provision-tenant-solana-treasury';
import { prisma } from '@sendero/database';
import { ensureOrgIdentity } from '@sendero/tools/provision-identity';
import { type NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parsePrimaryChain(input: unknown): 'sol' | 'arc' {
  if (typeof input === 'string') {
    if (input === 'sol' || input === 'arc') return input;
  }
  // Spec default: Solana-first onboarding.
  return 'sol';
}

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const { userId, orgId } = await auth();
  if (!userId || !orgId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Body is optional — legacy callers (the old "Run provisioning without
  // webhook" button) don't send one. Defaults to 'sol' so the chain-select
  // flow's Solana-first default holds even if the client races the body.
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const primaryChain = parsePrimaryChain(
    (body as { primaryChain?: unknown } | null)?.primaryChain
  );

  const client = await clerkClient();
  const org = await client.organizations.getOrganization({ organizationId: orgId });
  const name = org.name;
  const slug = org.slug ?? orgId;

  // Upsert with the chosen primaryChain on BOTH create and update, so a
  // user who previously hit the page (defaulting to arc) and now picks
  // sol gets their Tenant row flipped before provisioning fires.
  const tenant = await prisma.tenant.upsert({
    where: { clerkOrgId: orgId },
    create: {
      clerkOrgId: orgId,
      slug,
      displayName: name,
      billingTier: 'free',
      primaryChain,
    },
    update: { slug, displayName: name, primaryChain },
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

  // Best-effort identity intent for Arc parity. Failure is non-fatal —
  // the retry-identity-provision sweeper picks pending rows up.
  try {
    await ensureOrgIdentity({ tenantId: tenant.id });
  } catch (err) {
    console.warn('[dev/complete-org-provisioning] arc identity failed (non-fatal)', {
      tenantId: tenant.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

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
