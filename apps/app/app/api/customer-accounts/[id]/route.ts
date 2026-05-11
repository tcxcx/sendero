/**
 * Customer-account detail view for the TMC operator dashboard.
 *
 * GET /api/customer-accounts/[id] returns the account + counts of
 * installs / employees / trips, scoped to the current tenant.
 */

import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { prisma } from '@sendero/database';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { orgId } = await auth();
  if (!orgId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const tenant = await prisma.tenant.findUnique({
    where: { clerkOrgId: orgId },
    select: { id: true },
  });
  if (!tenant) {
    return NextResponse.json({ error: 'tenant_not_found' }, { status: 404 });
  }

  const { id } = await params;
  // Tenant-bind in the WHERE so the row CAN'T leak cross-tenant.
  const account = await prisma.customerAccount.findFirst({
    where: { id, tenantId: tenant.id },
    select: {
      id: true,
      displayName: true,
      primaryDomain: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      slackInstalls: {
        where: { revokedAt: null },
        select: {
          id: true,
          teamId: true,
          teamName: true,
          installedAt: true,
          kind: true,
        },
      },
      _count: { select: { users: true, policies: true, trips: true } },
    },
  });

  if (!account) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  return NextResponse.json({ account });
}
