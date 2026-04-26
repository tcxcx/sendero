/**
 * `POST /api/trips/create` — operator-side, lightweight Trip creation.
 *
 * Distinct from /api/guest/invite (which prefunds an escrow + mints a
 * claim link) — this route just opens a Trip row in 'draft' status
 * and redirects the operator to the trip detail surface, where they
 * can attach passengers, generate a prepaid claim later, etc.
 *
 * Wire: hitting this from the "New trip" button on /dashboard/trips.
 */

import { NextResponse } from 'next/server';

import { auth } from '@clerk/nextjs/server';
import { prisma, type Prisma } from '@sendero/database';

export const runtime = 'nodejs';

interface CreateBody {
  name?: string;
  intent?: Record<string, unknown>;
  travelerEmail?: string;
  travelerUserId?: string;
  groupTripId?: string;
  metadata?: Record<string, unknown>;
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session.orgId || !session.userId) {
    return NextResponse.json(
      { error: 'unauthorized', detail: 'Sign in as an operator with an active org.' },
      { status: 401 }
    );
  }

  const tenant = await prisma.tenant.findUnique({
    where: { clerkOrgId: session.orgId },
    select: { id: true },
  });
  if (!tenant) {
    return NextResponse.json({ error: 'tenant_not_found' }, { status: 404 });
  }

  let body: CreateBody = {};
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    /* empty body is fine — we'll create a blank draft. */
  }

  let travelerId: string | null = null;
  if (body.travelerUserId) {
    travelerId = body.travelerUserId;
  } else if (body.travelerEmail) {
    const u = await prisma.user.findUnique({
      where: { email: body.travelerEmail },
      select: { id: true },
    });
    if (!u) {
      return NextResponse.json(
        { error: 'traveler_not_found', email: body.travelerEmail },
        { status: 404 }
      );
    }
    travelerId = u.id;
  }

  const operator = await prisma.user.findUnique({
    where: { clerkUserId: session.userId },
    select: { id: true },
  });

  const trip = await prisma.trip.create({
    data: {
      tenantId: tenant.id,
      travelerId: travelerId ?? undefined,
      createdById: operator?.id ?? undefined,
      intent: (body.intent ?? {}) as Prisma.InputJsonValue,
      status: 'draft',
      metadata: {
        ...(body.metadata ?? {}),
        ...(body.name ? { name: body.name } : {}),
        ...(body.groupTripId ? { groupTripId: body.groupTripId } : {}),
        source: 'dashboard_create_trip',
      } as Prisma.InputJsonValue,
    },
    select: { id: true },
  });

  return NextResponse.json({
    ok: true,
    tripId: trip.id,
    href: `/dashboard/trips/${trip.id}`,
  });
}
