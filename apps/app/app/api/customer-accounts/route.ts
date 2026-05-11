/**
 * Customer-account CRUD for the TMC operator dashboard.
 *
 * - GET    /api/customer-accounts          → list this tenant's customer accounts
 * - POST   /api/customer-accounts          → create a customer account (status='invited')
 *
 * Detail + invite-mint live in sibling routes:
 * - GET    /api/customer-accounts/[id]
 * - POST   /api/customer-accounts/[id]/invite
 *
 * Auth: Clerk org session → tenant lookup. Operator's Clerk userId is
 * stamped as `createdByOperatorId` for audit trail.
 *
 * Phase 1 of the B2B2B Slack-install rollout — see memory
 * `customer_account_slack_install.md`.
 */

import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@sendero/database';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CreateBodySchema = z.object({
  displayName: z.string().min(1).max(200),
  primaryDomain: z
    .string()
    .min(3)
    .max(253)
    .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i)
    .optional(),
});

export async function GET() {
  const { orgId } = await auth();
  if (!orgId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const tenant = await prisma.tenant.findUnique({
    where: { clerkOrgId: orgId },
    select: { id: true },
  });
  if (!tenant) {
    return NextResponse.json({ accounts: [] });
  }

  const accounts = await prisma.customerAccount.findMany({
    where: { tenantId: tenant.id },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      displayName: true,
      primaryDomain: true,
      status: true,
      createdAt: true,
      _count: { select: { slackInstalls: true, users: true, trips: true } },
    },
  });

  return NextResponse.json({ accounts });
}

export async function POST(req: Request) {
  const { orgId, userId } = await auth();
  if (!orgId || !userId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const tenant = await prisma.tenant.findUnique({
    where: { clerkOrgId: orgId },
    select: { id: true },
  });
  if (!tenant) {
    return NextResponse.json({ error: 'tenant_not_found' }, { status: 404 });
  }

  let body: z.infer<typeof CreateBodySchema>;
  try {
    body = CreateBodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: 'bad_request', details: err instanceof Error ? err.message : 'invalid' },
      { status: 400 }
    );
  }

  try {
    const account = await prisma.customerAccount.create({
      data: {
        tenantId: tenant.id,
        displayName: body.displayName,
        primaryDomain: body.primaryDomain?.toLowerCase() ?? null,
        status: 'invited',
        createdByOperatorId: userId,
      },
      select: {
        id: true,
        displayName: true,
        primaryDomain: true,
        status: true,
        createdAt: true,
      },
    });
    return NextResponse.json({ account }, { status: 201 });
  } catch (err) {
    // Unique-violation on (tenantId, primaryDomain) → 409
    if (err instanceof Error && err.message.includes('Unique constraint')) {
      return NextResponse.json(
        { error: 'domain_already_registered' },
        { status: 409 }
      );
    }
    console.error('[customer-accounts] create failed:', err);
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}
