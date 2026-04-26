/**
 * GET / POST /api/tenant/pricing-policy
 *
 * Operator-facing endpoints for the per-tenant markup policy that the
 * `confirm_booking` agent tool reads at quote-draft time. Policies are
 * versioned + append-only — every change is a new row, never an UPDATE.
 *
 * GET returns the latest policy plus a derived `status` shape so the
 * agent surface (DX D5) can tell humans what's missing without a second
 * round-trip ("partial — set markup for `flight` to start quoting flights").
 *
 * POST inserts a new version with monotonic `version` per tenant. When
 * the body sets `activate=true`, the route runs the treasury preflight
 * (Eng A1) — no point activating a policy if the tenant treasury wallet
 * isn't provisioned yet, since `confirm_booking` would just hit
 * `TREASURY_NOT_PROVISIONED` on every settle.
 *
 * The seed v0 row is written by the Clerk `organization.created` webhook
 * with `sandboxOnly=true, activated=true` so sandbox keys can smoke-test
 * `confirm_booking` immediately. Production keys ignore `sandboxOnly`
 * rows and require a tenant-set policy via this route.
 */

import { auth } from '@clerk/nextjs/server';
import { prisma } from '@sendero/database';
import { MarkupConfigSchema } from '@sendero/billing';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { ApiErrors, apiErrorResponse } from '@/lib/api-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ── Body schema ──────────────────────────────────────────────────────

const PostBody = z.object({
  /**
   * Per-`BookingKind` markup configuration. v1 only honors
   * `strategy: 'static'`; the other variants pass Zod (so a tenant can
   * configure them in advance) but the booking tool returns a clear
   * v2-feature error rather than silently honoring them.
   */
  markupConfig: MarkupConfigSchema,
  /** Floor on tenant markup, in micro-USDC. Default $1. */
  floorMicroUsdc: z.coerce
    .bigint()
    .refine(v => v >= 0n, 'must be non-negative')
    .optional(),
  /** Optional self-imposed ceiling on tenant markup, in micro-USDC. */
  ceilingMicroUsdc: z.coerce
    .bigint()
    .refine(v => v >= 0n, 'must be non-negative')
    .optional(),
  /** 'add_to_customer' (default) | 'deduct_from_markup' (absorb). */
  senderoTakeBehavior: z.enum(['add_to_customer', 'deduct_from_markup']).optional(),
  /** When true, route runs treasury preflight + flips `activated` on the new row. */
  activate: z.boolean().optional(),
});

// ── Status derivation ────────────────────────────────────────────────

const ALL_KINDS = ['flight', 'hotel', 'rail', 'car', 'other'] as const;

type PolicyStatus = 'active' | 'inactive' | 'partial' | 'sandbox_seed';

function derivePolicyStatus(row: {
  activated: unknown;
  sandboxOnly: unknown;
  markupConfig: unknown;
}): { status: PolicyStatus; missingKinds: string[] } {
  const cfg =
    row.markupConfig && typeof row.markupConfig === 'object'
      ? (row.markupConfig as Record<string, unknown>)
      : {};
  const missingKinds = ALL_KINDS.filter(k => !cfg[k]);
  const sandboxOnly = row.sandboxOnly === true;
  const activated = row.activated === true;

  if (sandboxOnly) return { status: 'sandbox_seed', missingKinds };
  if (!activated) return { status: 'inactive', missingKinds };
  if (missingKinds.length > 0) return { status: 'partial', missingKinds };
  return { status: 'active', missingKinds: [] };
}

// ── Treasury preflight (Eng A1) ──────────────────────────────────────

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

async function tenantHasProvisionedTreasury(tenantId: string): Promise<boolean> {
  const wallet = await prisma.circleWallet.findFirst({
    where: { tenantId },
    select: { address: true },
  });
  if (!wallet) return false;
  if (!wallet.address) return false;
  if (wallet.address.toLowerCase() === ZERO_ADDRESS) return false;
  return true;
}

// ── Auth helper (API-flavored — returns 401 instead of redirecting) ──

async function authedTenantOrError() {
  const { userId, orgId } = await auth();
  if (!userId) return { error: ApiErrors.unauthorized() } as const;
  if (!orgId) return { error: ApiErrors.forbidden('No active organization.') } as const;

  const tenant = await prisma.tenant.findUnique({
    where: { clerkOrgId: orgId },
    select: { id: true, displayName: true },
  });
  if (!tenant) {
    return {
      error: apiErrorResponse({
        status: 404,
        code: 'TENANT_NOT_FOUND',
        message: 'Active organization is not yet provisioned in Sendero.',
      }),
    } as const;
  }
  return { tenant, userId } as const;
}

// ── GET ──────────────────────────────────────────────────────────────

export async function GET() {
  const ctx = await authedTenantOrError();
  if ('error' in ctx) return ctx.error;

  const policy = await prisma.tenantPricingPolicy.findFirst({
    where: { tenantId: ctx.tenant.id },
    orderBy: { version: 'desc' },
    select: {
      id: true,
      version: true,
      markupConfig: true,
      floorMicroUsdc: true,
      ceilingMicroUsdc: true,
      senderoTakeBehavior: true,
      activated: true,
      sandboxOnly: true,
      createdAt: true,
    },
  });
  if (!policy) return ApiErrors.policyNotInitialized();

  const { status, missingKinds } = derivePolicyStatus(policy);

  return NextResponse.json({
    tenantId: ctx.tenant.id,
    policy: {
      ...policy,
      // BigInt → string for JSON safety
      floorMicroUsdc: policy.floorMicroUsdc.toString(),
      ceilingMicroUsdc: policy.ceilingMicroUsdc?.toString() ?? null,
    },
    status,
    missingKinds,
  });
}

// ── POST ─────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const ctx = await authedTenantOrError();
  if ('error' in ctx) return ctx.error;

  let body: z.infer<typeof PostBody>;
  try {
    body = PostBody.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return ApiErrors.markupConfigInvalid(err.issues);
    }
    return apiErrorResponse({
      status: 400,
      code: 'INVALID_JSON',
      message: 'Request body must be valid JSON matching the policy schema.',
    });
  }

  // Treasury preflight gates activation only — a tenant can stage an
  // unactivated policy ahead of treasury provisioning, then flip it
  // once the wallet's ready via a follow-up POST with `activate=true`.
  if (body.activate) {
    const ok = await tenantHasProvisionedTreasury(ctx.tenant.id);
    if (!ok) return ApiErrors.treasuryNotProvisioned();
  }

  // Compute the next monotonic version. We do it inside a tx so two
  // simultaneous POSTs can't both write version N+1 (the (tenantId, version)
  // unique constraint is the second line of defense).
  const created = await prisma.$transaction(async tx => {
    const latest = await tx.tenantPricingPolicy.findFirst({
      where: { tenantId: ctx.tenant.id },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const nextVersion = (latest?.version ?? -1) + 1;

    return tx.tenantPricingPolicy.create({
      data: {
        tenantId: ctx.tenant.id,
        version: nextVersion,
        markupConfig: body.markupConfig as object,
        ...(body.floorMicroUsdc !== undefined ? { floorMicroUsdc: body.floorMicroUsdc } : {}),
        ...(body.ceilingMicroUsdc !== undefined ? { ceilingMicroUsdc: body.ceilingMicroUsdc } : {}),
        ...(body.senderoTakeBehavior ? { senderoTakeBehavior: body.senderoTakeBehavior } : {}),
        activated: body.activate ?? false,
        sandboxOnly: false, // user-created policies are never sandbox-only
        createdById: ctx.userId,
      },
      select: {
        id: true,
        version: true,
        activated: true,
        sandboxOnly: true,
        markupConfig: true,
      },
    });
  });

  const { status, missingKinds } = derivePolicyStatus(created);

  return NextResponse.json(
    {
      ok: true,
      policyId: created.id,
      policyVersion: created.version,
      activated: created.activated,
      status,
      missingKinds,
    },
    { status: 201 }
  );
}
