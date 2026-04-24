/**
 * POST /api/inbox/[tripId]/reply
 *
 * Tenant-scoped operator reply endpoint for the trip-thread workspace.
 * The operator's message is appended to `Trip.events` as an auditable
 * log entry. When `isInternal=false` and the channel has a delivery
 * adapter wired, the endpoint will also push the message through the
 * channel (WhatsApp / Slack / email). Today, delivery is intent-only —
 * the event record carries `status: 'pending_delivery'` so a follow-up
 * worker can reconcile it with the actual adapter call.
 *
 * Auth: Clerk org (admin/member/finance) + tenant match. The trip must
 * belong to the active Clerk org's tenant.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { auth } from '@clerk/nextjs/server';
import { prisma } from '@sendero/database';
import type { Prisma } from '@sendero/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  channel: z.enum(['whatsapp', 'slack', 'email', 'web', 'internal']),
  isInternal: z.boolean().default(false),
  text: z.string().min(1).max(4000),
  authorName: z.string().max(120).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const { userId, orgId } = await auth();
  if (!userId || !orgId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const tenant = await prisma.tenant.findUnique({
    where: { clerkOrgId: orgId },
    select: { id: true },
  });
  if (!tenant) {
    return NextResponse.json({ error: 'tenant_not_found' }, { status: 404 });
  }

  const body = BodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json(
      { error: 'invalid_body', issues: body.error.flatten() },
      { status: 400 }
    );
  }

  const trip = await prisma.trip.findFirst({
    where: { id: tripId, tenantId: tenant.id },
    select: { id: true, events: true },
  });
  if (!trip) {
    return NextResponse.json({ error: 'trip_not_found' }, { status: 404 });
  }

  const entry = {
    id: `reply_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    kind: 'inbox_reply',
    direction: 'outbound',
    channel: body.data.channel,
    isInternal: body.data.isInternal || body.data.channel === 'internal',
    text: body.data.text,
    authorUserId: userId,
    authorName: body.data.authorName ?? null,
    status:
      body.data.isInternal || body.data.channel === 'internal' ? 'internal' : 'pending_delivery',
    createdAt: new Date().toISOString(),
  };

  const existing = Array.isArray(trip.events) ? (trip.events as Prisma.JsonArray) : [];
  const nextEvents = [...existing, entry];

  await prisma.trip.update({
    where: { id: trip.id },
    data: {
      events: nextEvents as Prisma.InputJsonValue,
    },
  });

  return NextResponse.json({ id: entry.id, createdAt: entry.createdAt, status: entry.status });
}
