/**
 * GET /api/me/profile
 *
 * Traveler profile read — Clerk-authed, no org required.
 *
 * Returns:
 *   {
 *     userId, displayName, email, phone,
 *     primaryTenant: { id, displayName },     // first tenant that ever provisioned them
 *     tenants: Array<{ id, displayName, tripCount }>, // all tenants the traveler has trips with
 *     wallet: { gatewayAddress, hasDcw },
 *   }
 *
 * The `primaryTenant` link survives without burning a Clerk org seat —
 * it's stamped on `User.metadata.primaryTenantId` by the agent traveler
 * resolver on first WhatsApp inbound, and preserved across the merge
 * route's placeholder → Clerk user reconciliation.
 */

import { auth } from '@clerk/nextjs/server';
import { type NextRequest, NextResponse } from 'next/server';

import { prisma } from '@sendero/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { clerkUserId },
    select: {
      id: true,
      displayName: true,
      email: true,
      phone: true,
      metadata: true,
      gatewaySigner: { select: { address: true } },
      wallets: {
        where: { provisioner: 'dcw' },
        select: { id: true },
        take: 1,
      },
    },
  });
  if (!user) {
    return NextResponse.json({ error: 'user_not_found' }, { status: 404 });
  }

  const meta = (user.metadata ?? {}) as Record<string, unknown>;
  const primaryTenantId = typeof meta.primaryTenantId === 'string' ? meta.primaryTenantId : null;

  // All tenants the traveler has trips with — single Postgres roundtrip.
  const trips = await prisma.trip.groupBy({
    by: ['tenantId'],
    where: { travelerId: user.id },
    _count: { tenantId: true },
  });
  const tenantIds = trips.map(t => t.tenantId);
  if (primaryTenantId && !tenantIds.includes(primaryTenantId)) {
    tenantIds.push(primaryTenantId);
  }
  const tenantRows = tenantIds.length
    ? await prisma.tenant.findMany({
        where: { id: { in: tenantIds } },
        select: { id: true, displayName: true, slug: true },
      })
    : [];
  const tenantsById = new Map(tenantRows.map(t => [t.id, t]));

  return NextResponse.json({
    userId: user.id,
    displayName: user.displayName,
    email: user.email,
    phone: user.phone,
    primaryTenant: primaryTenantId
      ? {
          id: primaryTenantId,
          displayName: tenantsById.get(primaryTenantId)?.displayName ?? null,
          slug: tenantsById.get(primaryTenantId)?.slug ?? null,
        }
      : null,
    tenants: trips.map(t => ({
      id: t.tenantId,
      displayName: tenantsById.get(t.tenantId)?.displayName ?? null,
      slug: tenantsById.get(t.tenantId)?.slug ?? null,
      tripCount: t._count.tenantId,
    })),
    wallet: {
      gatewayAddress: user.gatewaySigner?.address ?? null,
      hasDcw: user.wallets.length > 0,
    },
  });
}
