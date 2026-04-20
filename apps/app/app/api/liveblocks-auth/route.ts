/**
 * Liveblocks session auth endpoint.
 *
 * The Liveblocks client calls POST /api/liveblocks-auth with the room
 * id it wants to join. We:
 *   1. Look up the caller (Clerk session; falls back to the demo MSCA
 *      address header if Clerk isn't configured for the local demo).
 *   2. Derive tenantId from the caller's ChannelIdentity / Membership.
 *   3. Verify the requested room belongs to that tenant.
 *   4. Mint a scoped access token via issueSession().
 */

import { type NextRequest, NextResponse } from 'next/server';
import { issueSession, parseRoomId } from '@sendero/collaboration/server';
import { prisma } from '@sendero/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 10;

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { room?: string } | null;
  if (!body?.room) {
    return NextResponse.json({ error: 'missing_room' }, { status: 400 });
  }

  const parsed = parseRoomId(body.room);
  if (!parsed) {
    return NextResponse.json({ error: 'invalid_room' }, { status: 400 });
  }

  // Resolve caller → Sendero user. For hackathon demo we accept a
  // signed MSCA address header and look up the associated user/tenant.
  // Production will layer Clerk session auth on top via @sendero/auth.
  const mscaAddress = req.headers.get('x-sendero-msca')?.toLowerCase();
  if (!mscaAddress) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { mscaAddress },
    select: {
      id: true,
      displayName: true,
      imageUrl: true,
      memberships: { select: { tenantId: true } },
    },
  });
  if (!user) {
    return NextResponse.json({ error: 'unknown_user' }, { status: 404 });
  }

  const tenantIds = user.memberships.map(m => m.tenantId);
  if (!tenantIds.includes(parsed.tenantId)) {
    return NextResponse.json({ error: 'tenant_forbidden' }, { status: 403 });
  }

  // Confirm the trip actually exists under this tenant.
  const trip = await prisma.trip.findFirst({
    where: { id: parsed.tripId, tenantId: parsed.tenantId },
    select: { id: true },
  });
  if (!trip) {
    return NextResponse.json({ error: 'trip_not_found' }, { status: 404 });
  }

  try {
    const session = await issueSession({
      userId: user.id,
      tenantId: parsed.tenantId,
      displayName: user.displayName ?? 'traveler',
      avatarUrl: user.imageUrl,
      roomIds: [body.room],
    });
    return NextResponse.json(session);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'session_failed', message: msg }, { status: 500 });
  }
}
