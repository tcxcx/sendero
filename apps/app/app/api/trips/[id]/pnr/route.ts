/**
 * GET /api/trips/:id/pnr
 *
 * Breadcrumb helper. Returns the most recent booking PNR (or Duffel
 * booking reference) for a trip, scoped to the current tenant. Null
 * when no booking has minted a record locator yet.
 */

import { prisma } from '@sendero/database';
import { NextResponse, type NextRequest } from 'next/server';

import { requireCurrentTenant } from '@/lib/tenant-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { tenant } = await requireCurrentTenant();

  const trip = await prisma.trip.findFirst({
    where: { id, tenantId: tenant.id },
    select: { id: true },
  });
  if (!trip) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const booking = await prisma.booking.findFirst({
    where: { tripId: id, tenantId: tenant.id, pnr: { not: null } },
    orderBy: { bookedAt: 'desc' },
    select: { pnr: true },
  });

  return NextResponse.json({ pnr: booking?.pnr ?? null });
}
