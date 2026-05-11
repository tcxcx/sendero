/**
 * GET  /api/customer-accounts/[id]/policy
 * PUT  /api/customer-accounts/[id]/policy
 *
 * Per-CustomerAccount travel policy CRUD. Tenant-scoped via Clerk
 * session — the queried CustomerAccount must belong to the caller's
 * tenant. Used by `/dashboard/customer-accounts/[id]/policy` to let
 * the TMC operator set / edit the corporate travel rules that the
 * agent gates each booking against (see `check_policy` Tier 1 — same
 * Policy row, same `rules` JSON schema).
 *
 * GET returns the current policy (or `policy: null` when none seeded).
 * PUT validates the rules with Zod, upserts the row, increments
 * `version` on each save (cheap audit trail; Phase 4 hooks Trip
 * snapshots to it).
 */

import { auth } from '@clerk/nextjs/server';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@sendero/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const rulesSchema = z.object({
  maxFlightUsd: z.number().nonnegative(),
  maxNightUsd: z.number().nonnegative(),
  intlCabinMinHours: z.number().nonnegative(),
  intlCabinRequired: z.enum(['business', 'first', 'premium_economy']),
  domesticCabin: z.enum(['economy', 'premium_economy']),
  preferredCarriers: z.array(z.string()).default([]),
  blacklistSuppliers: z.array(z.string()).default([]),
  requireApproverOverUsd: z.number().nonnegative(),
  fiscalCountry: z.enum(['MX', 'BR', 'AR', 'US', 'GB']),
});

const putBody = z.object({
  displayName: z.string().min(1).max(120).optional(),
  rules: rulesSchema,
});

async function resolveAccount(orgId: string, accountId: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { clerkOrgId: orgId },
    select: { id: true },
  });
  if (!tenant) return { error: 'no_tenant' as const };
  const account = await prisma.customerAccount.findFirst({
    where: { id: accountId, tenantId: tenant.id },
    select: { id: true, displayName: true, tenantId: true },
  });
  if (!account) return { error: 'not_found' as const };
  return { tenant, account };
}

function slugForAccount(displayName: string): string {
  // URL-safe slug from the corporate display name; suffix with the
  // year so the operator sees policy editions over time when they list.
  const year = new Date().getFullYear();
  const base = displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return `${base || 'policy'}-${year}`;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { orgId } = await auth();
  if (!orgId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const resolved = await resolveAccount(orgId, id);
  if ('error' in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: 404 });
  }

  // Latest version wins. Order by (version desc, updatedAt desc) so
  // even legacy rows without versioning resolve deterministically.
  const policy = await prisma.policy.findFirst({
    where: { tenantId: resolved.account.tenantId, customerAccountId: resolved.account.id },
    orderBy: [{ version: 'desc' }, { updatedAt: 'desc' }],
    select: {
      id: true,
      slug: true,
      displayName: true,
      rules: true,
      version: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({
    account: {
      id: resolved.account.id,
      displayName: resolved.account.displayName,
    },
    policy,
  });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { orgId } = await auth();
  if (!orgId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const resolved = await resolveAccount(orgId, id);
  if ('error' in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 });
  }
  const parsed = putBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_rules', issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const displayName = parsed.data.displayName ?? `${resolved.account.displayName} travel policy`;

  // Upsert + bump version. Find existing latest row for this scope,
  // then either update + version++ (preserves slug for audit) or
  // create the first version with a fresh slug.
  const existing = await prisma.policy.findFirst({
    where: { tenantId: resolved.account.tenantId, customerAccountId: resolved.account.id },
    orderBy: [{ version: 'desc' }, { updatedAt: 'desc' }],
    select: { id: true, slug: true, version: true },
  });

  const next = existing
    ? await prisma.policy.update({
        where: { id: existing.id },
        data: {
          displayName,
          rules: parsed.data.rules,
          version: existing.version + 1,
        },
        select: {
          id: true,
          slug: true,
          displayName: true,
          rules: true,
          version: true,
          updatedAt: true,
        },
      })
    : await prisma.policy.create({
        data: {
          tenantId: resolved.account.tenantId,
          customerAccountId: resolved.account.id,
          slug: slugForAccount(resolved.account.displayName),
          displayName,
          rules: parsed.data.rules,
          isDefault: false,
          version: 1,
        },
        select: {
          id: true,
          slug: true,
          displayName: true,
          rules: true,
          version: true,
          updatedAt: true,
        },
      });

  return NextResponse.json({ ok: true, policy: next });
}
