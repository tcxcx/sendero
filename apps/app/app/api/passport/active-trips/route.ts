/**
 * GET /api/passport/active-trips
 *
 * Lightweight read for the post-save passport card. Returns the
 * tenant's open trips so the user can pick one to apply the passport
 * to. Returns an empty list (not 404) when no trips exist — the UI
 * uses that signal to redirect the user to /dashboard/trips.
 */

import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

import { prisma } from '@sendero/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OPEN_STATUSES = ['draft', 'searching', 'awaiting_approval', 'booked', 'in_progress'] as const;

export async function GET() {
  console.log('[passport/active-trips] ▶ GET received');
  const { userId, orgId } = await auth();
  console.log('[passport/active-trips] auth()', {
    hasUserId: Boolean(userId),
    hasOrgId: Boolean(orgId),
  });
  if (!userId || !orgId) {
    console.warn('[passport/active-trips] ✕ unauthorized', { userId, orgId });
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const tenant = await prisma.tenant.findUnique({
    where: { clerkOrgId: orgId },
    select: { id: true },
  });
  if (!tenant) {
    console.warn('[passport/active-trips] ✕ tenant_not_found', { orgId });
    return NextResponse.json({ error: 'tenant_not_found' }, { status: 404 });
  }

  const trips = await prisma.trip.findMany({
    where: { tenantId: tenant.id, status: { in: [...OPEN_STATUSES] } },
    orderBy: { createdAt: 'desc' },
    take: 6,
    select: {
      id: true,
      status: true,
      intent: true,
      metadata: true,
      createdAt: true,
      traveler: { select: { displayName: true, email: true } },
    },
  });
  console.log('[passport/active-trips] ✓ ok', { tenantId: tenant.id, tripCount: trips.length });

  return NextResponse.json({
    trips: trips.map(t => ({
      id: t.id,
      status: t.status,
      intent: t.intent,
      destination: pickDestination(t.metadata, t.intent),
      travelerLabel: t.traveler?.displayName ?? t.traveler?.email ?? null,
      createdAt: t.createdAt.toISOString(),
    })),
  });
}

function pickDestination(metadata: unknown, intent: unknown): string | null {
  if (metadata && typeof metadata === 'object') {
    const m = metadata as Record<string, unknown>;
    const dest = m.destination ?? m.to ?? m.city;
    if (typeof dest === 'string' && dest.trim()) return dest.trim();
  }
  if (intent && typeof intent === 'object') {
    const i = intent as Record<string, unknown>;
    const dest = i.destination ?? i.to;
    if (typeof dest === 'string' && dest.trim()) return dest.trim();
  }
  return null;
}
