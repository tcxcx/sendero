/**
 * POST /api/inbox/[tripId]/reply
 *
 * Tenant-scoped operator reply endpoint for the trip-thread workspace.
 * The operator's message is appended to `Trip.events` as an auditable
 * log entry AND, when not internal, dispatched to the traveler over
 * their resolved primary channel via `dispatchToTraveler` (Phase G.4).
 *
 * Auth: Clerk org (admin/member/finance) + tenant match. The trip must
 * belong to the active Clerk org's tenant.
 */

import { randomUUID } from 'node:crypto';

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { auth } from '@clerk/nextjs/server';
import { prisma } from '@sendero/database';
import type { Prisma } from '@sendero/database';

import { dispatchToTraveler } from '@/lib/channel-dispatch';
import { notifyTripEvent } from '@/lib/trip-events-notify';

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
    select: { id: true, events: true, travelerId: true },
  });
  if (!trip) {
    return NextResponse.json({ error: 'trip_not_found' }, { status: 404 });
  }

  const isInternal = body.data.isInternal || body.data.channel === 'internal';

  // Dispatch first when targeting the traveler so the audit row carries
  // the actual delivery outcome. Internal asides skip dispatch.
  let deliveryStatus: 'internal' | 'sent' | 'failed_delivery' | 'no_channel' = 'internal';
  let deliveryDetail: unknown = null;
  let deliveredChannel: 'whatsapp' | 'slack' | null = null;

  if (!isInternal && trip.travelerId) {
    const dispatch = await dispatchToTraveler({
      tripId: trip.id,
      tenantId: tenant.id,
      travelerUserId: trip.travelerId,
      message: {
        kind: 'text',
        id: randomUUID(),
        author: {
          role: 'operator',
          name: body.data.authorName ?? 'Sendero',
        },
        content: body.data.text,
        createdAt: new Date().toISOString(),
      },
    });
    if (dispatch.sent === true) {
      deliveryStatus = 'sent';
      deliveredChannel = dispatch.channel;
      deliveryDetail = dispatch.detail ?? null;
    } else {
      deliveryStatus = dispatch.reason === 'no_traveler_channel' ? 'no_channel' : 'failed_delivery';
      deliveryDetail = { reason: dispatch.reason, detail: dispatch.detail ?? null };
    }
  } else if (!isInternal && !trip.travelerId) {
    deliveryStatus = 'no_channel';
    deliveryDetail = { reason: 'trip_has_no_traveler' };
  }

  const entry = {
    id: `reply_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    kind: 'inbox_reply',
    direction: 'outbound',
    channel: deliveredChannel ?? body.data.channel,
    isInternal,
    text: body.data.text,
    authorUserId: userId,
    authorName: body.data.authorName ?? null,
    status: deliveryStatus,
    deliveryDetail,
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

  void notifyTripEvent({
    tenantId: tenant.id,
    tripId: trip.id,
    entry: {
      id: entry.id,
      kind: entry.kind,
      direction: 'outbound',
      channel: entry.channel,
      status: entry.status,
      createdAt: entry.createdAt,
    },
  });

  return NextResponse.json({
    id: entry.id,
    createdAt: entry.createdAt,
    status: entry.status,
    channel: entry.channel,
  });
}
