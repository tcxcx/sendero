/**
 * POST /api/internal/console/trip/[tripId]/inject
 *
 * Operator-side rich-message inject. The text-only path lives in
 * `/api/inbox/[tripId]/reply`; this endpoint accepts the wider
 * `ChannelMessage` shape (card with title/body/bullets/imageUrl/ctas)
 * so the operator console can push share-card-style content into the
 * traveler's primary channel without going through the agent.
 *
 * Auth: Clerk org. The trip's tenant must match the active org. No
 * shared-secret path — this is operator-only and the dispatcher
 * already trusts the validated tenant + travelerId.
 *
 * Audit: appends to `Trip.events` with the actual delivery outcome
 * (`sent` / `failed_delivery` / `no_channel`) so the timeline reflects
 * the dispatch result, not just the operator's intent.
 */

import { randomUUID } from 'node:crypto';

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { auth } from '@clerk/nextjs/server';
import { prisma } from '@sendero/database';
import type { Prisma } from '@sendero/database';

import { dispatchToTraveler } from '@/lib/channel-dispatch';
import type { ChannelCta, ChannelMessage } from '@/lib/channel-render';
import { notifyTripEvent } from '@/lib/trip-events-notify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CtaSchema = z.object({
  label: z.string().min(1).max(40),
  kind: z.enum([
    'approve',
    'reject',
    'cancel',
    'confirm_change',
    'select_offer',
    'confirm_cancel',
    'open_link',
    'tool_invoke',
    'reply',
  ]),
  value: z.string().max(512).optional(),
  href: z.string().url().max(2048).optional(),
  emphasis: z.enum(['primary', 'secondary']).optional(),
});

const BodySchema = z.object({
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(2000),
  bullets: z.array(z.string().min(1).max(160)).max(6).optional(),
  imageUrl: z.string().url().max(2048).optional(),
  ctas: z.array(CtaSchema).max(3).optional(),
  authorName: z.string().min(1).max(80).optional(),
  forceChannel: z.enum(['whatsapp', 'slack']).optional(),
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
  if (!trip.travelerId) {
    return NextResponse.json({ error: 'trip_has_no_traveler' }, { status: 400 });
  }

  const ctas: ChannelCta[] = (body.data.ctas ?? []).map(c => ({
    label: c.label,
    kind: c.kind,
    ...(c.value !== undefined ? { value: c.value } : {}),
    ...(c.href !== undefined ? { href: c.href } : {}),
    ...(c.emphasis !== undefined ? { emphasis: c.emphasis } : {}),
  }));

  const message: ChannelMessage = {
    kind: 'card',
    id: randomUUID(),
    author: { role: 'operator', name: body.data.authorName ?? 'Sendero' },
    title: body.data.title,
    body: body.data.body,
    ...(body.data.bullets && body.data.bullets.length > 0 ? { bullets: body.data.bullets } : {}),
    ...(body.data.imageUrl ? { imageUrl: body.data.imageUrl } : {}),
    ...(ctas.length > 0 ? { ctas } : {}),
    createdAt: new Date().toISOString(),
  };

  const dispatch = await dispatchToTraveler({
    tripId: trip.id,
    tenantId: tenant.id,
    travelerUserId: trip.travelerId,
    message,
    ...(body.data.forceChannel ? { forceChannel: body.data.forceChannel } : {}),
  });

  const status =
    dispatch.sent === true
      ? 'sent'
      : dispatch.reason === 'no_traveler_channel'
        ? 'no_channel'
        : 'failed_delivery';

  const entry = {
    id: `inject_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    kind: 'inbox_inject',
    direction: 'outbound',
    channel: dispatch.sent === true ? dispatch.channel : (body.data.forceChannel ?? null),
    isInternal: false,
    card: {
      title: body.data.title,
      body: body.data.body,
      bullets: body.data.bullets ?? null,
      imageUrl: body.data.imageUrl ?? null,
      ctas: ctas.length > 0 ? ctas : null,
    },
    authorUserId: userId,
    authorName: body.data.authorName ?? null,
    status,
    deliveryDetail:
      dispatch.sent === true
        ? (dispatch.detail ?? null)
        : { reason: dispatch.reason, detail: dispatch.detail ?? null },
    createdAt: new Date().toISOString(),
  };

  const existing = Array.isArray(trip.events) ? (trip.events as Prisma.JsonArray) : [];
  await prisma.trip.update({
    where: { id: trip.id },
    data: {
      events: [...existing, entry] as Prisma.InputJsonValue,
    },
  });

  void notifyTripEvent({
    tenantId: tenant.id,
    tripId: trip.id,
    entry: {
      id: entry.id,
      kind: entry.kind,
      direction: 'outbound',
      channel: entry.channel ?? null,
      status: entry.status,
      createdAt: entry.createdAt,
    },
  });

  return NextResponse.json({
    id: entry.id,
    createdAt: entry.createdAt,
    status,
    channel: entry.channel,
    deliveryDetail: entry.deliveryDetail,
  });
}
