/**
 * POST /api/dev/complete-org-provisioning
 *
 * Chain-select onboarding deploy endpoint. The `dev/` path prefix is
 * legacy from when this only filled in for unreachable Clerk webhooks
 * during localhost development — it's the canonical entry point for
 * the chain-aware provisioning ladder on every environment now.
 * (Rename to `/api/onboarding/deploy` is queued for a follow-up
 * commit once the client + any external callers are migrated.)
 *
 * Body: `{ primaryChain?: 'sol' | 'arc' }` — optional, defaults to 'sol'
 * (per the onboarding spec — Sendero is Solana-first now). The Tenant row
 * is upserted with the chosen chain BEFORE branching, so the user's
 * selection is what drives provisioning regardless of any prior default
 * the Clerk webhook may have stamped (it lacks the chain context the
 * user picks on `/onboarding`).
 *
 * Provisioning runs through `runTenantProvisioning`, the single chain-
 * aware orchestrator shared with the Clerk webhook. Per-stage progress
 * stamps into `Tenant.metadata.provisioning` so the wait screen can
 * render real state via `/api/onboarding/check-ready`.
 *
 * Auth-gated: Clerk session + active org required. Route refuses
 * cross-tenant calls — only the caller's own org can be provisioned.
 */

import { type NextRequest, NextResponse } from 'next/server';

import { auth, clerkClient } from '@clerk/nextjs/server';
import { prisma } from '@sendero/database';

import { readProvisioning } from '@/lib/provisioning-progress';
import { runTenantProvisioning } from '@/lib/run-tenant-provisioning';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parsePrimaryChain(input: unknown): 'sol' | 'arc' {
  if (typeof input === 'string') {
    if (input === 'sol' || input === 'arc') return input;
  }
  // Spec default: Solana-first onboarding.
  return 'sol';
}

/**
 * Tenant.slug is @unique. When a stale Tenant row from a prior Clerk org
 * (e.g. user deleted + recreated an org with the same name) already owns
 * the desired slug, the upsert's create-branch hits a unique-constraint
 * failure. Rather than 500, derive a slug that's deterministic per orgId
 * so re-runs land on the same row.
 */
async function resolveUniqueSlug(base: string, orgId: string): Promise<string> {
  const existing = await prisma.tenant.findUnique({ where: { slug: base } });
  if (!existing || existing.clerkOrgId === orgId) return base;
  // Stable suffix from orgId — same orgId always derives the same slug,
  // so re-running the deploy is idempotent.
  const suffix = orgId
    .replace(/[^a-z0-9]/gi, '')
    .slice(-6)
    .toLowerCase();
  return `${base}-${suffix}`;
}

export async function POST(req: NextRequest) {
  const { userId, orgId } = await auth();
  if (!userId || !orgId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Body is optional — legacy callers don't send one. Defaults to 'sol'.
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const primaryChain = parsePrimaryChain((body as { primaryChain?: unknown } | null)?.primaryChain);

  let stage = 'init';
  try {
    stage = 'clerk:getOrganization';
    const client = await clerkClient();
    const org = await client.organizations.getOrganization({ organizationId: orgId });
    const name = org.name;
    stage = 'prisma:resolveUniqueSlug';
    const slug = await resolveUniqueSlug(org.slug ?? orgId, orgId);

    // Upsert with the chosen primaryChain on BOTH create and update, so a
    // user who previously hit the page (defaulting to arc) and now picks
    // sol gets their Tenant row flipped before provisioning fires.
    stage = 'prisma:tenant.upsert';
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

    stage = 'runTenantProvisioning';
    const result = await runTenantProvisioning({
      tenantId: tenant.id,
      clerkOrgId: orgId,
      primaryChain: tenant.primaryChain as 'arc' | 'sol',
    });

    console.log('[dev/complete-org-provisioning] done', {
      orgId,
      tenantId: tenant.id,
      chain: result.chain,
      address: result.address,
      alreadyExisted: result.alreadyExisted,
      identityStatus: result.identityStatus,
      identityError: result.identityError,
    });

    return NextResponse.json({
      ok: true,
      chain: result.chain,
      tenantId: tenant.id,
      address: result.address,
      ...(result.chain === 'sol'
        ? { solTreasuryAddress: result.address }
        : { arcWalletAddress: result.address }),
      alreadyExisted: result.alreadyExisted,
      identityStatus: result.identityStatus,
      identityError: result.identityError,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;

    // Surface the stamped failure so the client can render which stage
    // blew up without waiting on the next /check-ready poll.
    let progress: unknown = null;
    try {
      const tenant = await prisma.tenant.findUnique({
        where: { clerkOrgId: orgId },
        select: { id: true },
      });
      if (tenant) progress = await readProvisioning(tenant.id);
    } catch {
      // best-effort; the route is already in an error path
    }

    console.error('[dev/complete-org-provisioning] FAILED', {
      orgId,
      userId,
      primaryChain,
      stage,
      message,
      stack,
    });
    return NextResponse.json(
      {
        error: 'provisioning_failed',
        stage,
        message,
        // Route is gated dev-only at the top, so stack is always safe to surface.
        stack,
        progress,
      },
      { status: 500 }
    );
  }
}
