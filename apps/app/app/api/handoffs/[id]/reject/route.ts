/**
 * POST /api/handoffs/[id]/reject
 *
 * Mirror of /approve — flips status to 'rejected'. Agent polling
 * sees the flip and reports back to the traveler instead of
 * proceeding with the booking.
 */

import { auth } from '@clerk/nextjs/server';
import { type NextRequest, NextResponse } from 'next/server';

import { prisma } from '@sendero/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { orgId, userId } = await auth();
  if (!orgId || !userId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tenant = await prisma.tenant.findUnique({
    where: { clerkOrgId: orgId },
    select: { id: true },
  });
  if (!tenant) {
    return NextResponse.json({ error: 'no_tenant' }, { status: 404 });
  }
  const { id } = await params;

  let note: string | null = null;
  try {
    const body = await req.json();
    if (typeof body?.note === 'string') note = body.note.slice(0, 1000);
  } catch {
    /* body optional */
  }

  const operator = await prisma.user.findFirst({
    where: { clerkUserId: userId },
    select: { id: true },
  });

  const handoff = await prisma.channelHandoff.findFirst({
    where: { id, tenantId: tenant.id, kind: 'approval_request' },
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
      status: 'rejected',
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
