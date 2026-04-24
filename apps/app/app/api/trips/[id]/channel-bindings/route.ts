/**
 * PATCH /api/trips/:id/channel-bindings
 *
 * Upserts per-trip channel override. Admin or the assigned traveler can
 * set it. Body is a zod-validated `TripChannelBindings`.
 */

import { prisma } from '@sendero/database';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { requireCurrentTenant } from '@/lib/tenant-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ChannelKind = z.enum(['whatsapp', 'slack', 'email', 'web']);
const Bindings = z.object({
  primary: ChannelKind,
  whatsapp: z.object({ identityId: z.string().min(1) }).optional(),
  slack: z.object({ channelId: z.string().min(1), threadTs: z.string().optional() }).optional(),
  notifyChannels: z.array(ChannelKind).max(4).optional(),
});

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { tenant, userId } = await requireCurrentTenant();

  const trip = await prisma.trip.findFirst({
    where: { id, tenantId: tenant.id },
    select: { id: true, travelerId: true, createdById: true },
  });
  if (!trip) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (trip.travelerId !== userId && trip.createdById !== userId) {
    // Let admins through at the route-handler level if needed; for v1
    // enforce a conservative default.
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const parsed = Bindings.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_bindings', issues: parsed.error.issues },
      { status: 400 }
    );
  }

  await prisma.trip.update({
    where: { id },
    data: { channelBindings: parsed.data },
  });
  return NextResponse.json({ ok: true, bindings: parsed.data });
}
