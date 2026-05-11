/**
 * POST /api/handoffs/[id]/approve
 *
 * Operator-driven decision endpoint for `approval_request` kind
 * ChannelHandoff rows. Flips status → 'approved', stamps the decider
 * and timestamp. Agent polls /api/handoffs/[id]/status and sees the
 * flip → proceeds with confirm_booking.
 *
 * Clerk session + tenant scope required. Operator must be a member of
 * the tenant that owns the handoff.
 */

import { auth } from '@clerk/nextjs/server';
import { type NextRequest, NextResponse } from 'next/server';

import { prisma } from '@sendero/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function resolveTenantUser(req: NextRequest) {
  const { orgId, userId } = await auth();
  if (!orgId || !userId) return null;
  const tenant = await prisma.tenant.findUnique({
    where: { clerkOrgId: orgId },
    select: { id: true },
  });
  if (!tenant) return null;
  return { tenantId: tenant.id, userId };
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await resolveTenantUser(req);
  if (!auth) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await params;

  let note: string | null = null;
  try {
    const body = await req.json();
    if (typeof body?.note === 'string') note = body.note.slice(0, 1000);
  } catch {
    /* body optional */
  }

  // Resolve the User row matching the Clerk userId so we can stamp
  // `answeredByUserId` (FK to User, not Clerk). Falls back to null
  // when the operator doesn't have a Sendero User row yet (shouldn't
  // happen in practice but keep the route resilient).
  const operator = await prisma.user.findFirst({
    where: { clerkUserId: auth.userId },
    select: { id: true },
  });

  const handoff = await prisma.channelHandoff.findFirst({
    where: { id, tenantId: auth.tenantId, kind: 'approval_request' },
    select: { id: true, status: true },
  });
  if (!handoff) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (handoff.status !== 'pending') {
    return NextResponse.json(
      { error: 'already_decided', status: handoff.status },
      { status: 409 }
    );
  }

  const updated = await prisma.channelHandoff.update({
    where: { id: handoff.id },
    data: {
      status: 'approved',
      answer: note,
      answeredByUserId: operator?.id ?? null,
      answeredAt: new Date(),
    },
    select: { id: true, status: true, answeredAt: true },
  });

  return NextResponse.json({
    ok: true,
    id: updated.id,
    status: updated.status,
    decidedAt: updated.answeredAt?.toISOString() ?? null,
  });
}
