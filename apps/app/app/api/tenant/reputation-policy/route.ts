/**
 * GET / PUT /api/tenant/reputation-policy
 *
 * Operator-facing endpoint to read and update the current tenant's
 * `ReputationPolicy`. GET returns the policy (or null when never set);
 * PUT upserts and returns the updated row. Both gated to the active
 * Clerk org's tenant — no cross-tenant policy editing.
 *
 * Defaults applied at upsert: enforcement='warn' (per locked decision)
 * so policies are non-blocking at launch and admins flip to 'block'
 * after surfacing violations in the dashboard.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@sendero/database';

import { requireCurrentTenant } from '@/lib/tenant-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PolicySchema = z.object({
  minStars: z.number().min(0).max(5).nullable().optional(),
  minTripCount: z.number().int().min(0).nullable().optional(),
  maxDisputeRatio: z.number().min(0).max(1).nullable().optional(),
  requireKyc: z.boolean().optional(),
  requireKyb: z.boolean().optional(),
  enforcement: z.enum(['block', 'warn', 'allow']).optional(),
});

export async function GET() {
  const { tenant } = await requireCurrentTenant();
  const policy = await prisma.reputationPolicy.findUnique({
    where: { tenantId: tenant.id },
  });
  return NextResponse.json({ tenantId: tenant.id, policy });
}

export async function PUT(req: Request) {
  const { tenant } = await requireCurrentTenant();
  let body: z.infer<typeof PolicySchema>;
  try {
    body = PolicySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: 'invalid_body', issues: err instanceof z.ZodError ? err.issues : [] },
      { status: 400 }
    );
  }

  const policy = await prisma.reputationPolicy.upsert({
    where: { tenantId: tenant.id },
    create: {
      tenantId: tenant.id,
      minStars: body.minStars ?? null,
      minTripCount: body.minTripCount ?? null,
      maxDisputeRatio: body.maxDisputeRatio ?? null,
      requireKyc: body.requireKyc ?? false,
      requireKyb: body.requireKyb ?? false,
      enforcement: body.enforcement ?? 'warn',
    },
    update: {
      minStars: body.minStars ?? null,
      minTripCount: body.minTripCount ?? null,
      maxDisputeRatio: body.maxDisputeRatio ?? null,
      requireKyc: body.requireKyc ?? false,
      requireKyb: body.requireKyb ?? false,
      enforcement: body.enforcement ?? 'warn',
    },
  });

  return NextResponse.json({ ok: true, policy });
}
