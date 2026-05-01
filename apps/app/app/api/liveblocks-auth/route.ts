/**
 * Liveblocks session auth endpoint.
 *
 * The Liveblocks client calls POST /api/liveblocks-auth with the room
 * id it wants to join. We resolve the caller through Clerk, map the
 * active organization to a Sendero tenant, verify the room belongs to
 * that tenant, and mint a room-scoped Liveblocks access token.
 */

import { type NextRequest, NextResponse } from 'next/server';

import { auth, currentUser } from '@clerk/nextjs/server';
import { identifySession, issueSession, parseRoomId } from '@sendero/collaboration/server';
import { prisma } from '@sendero/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 10;

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { room?: string } | null;
  const requestedRoom = typeof body?.room === 'string' ? body.room : undefined;
  const parsed = requestedRoom ? parseRoomId(requestedRoom) : null;
  if (requestedRoom && !parsed)
    return NextResponse.json({ error: 'invalid_room' }, { status: 400 });

  const { userId, orgId, has } = await auth();
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
  if (parsed && tenant.id !== parsed.tenantId) {
    return NextResponse.json({ error: 'tenant_forbidden' }, { status: 403 });
  }

  if (parsed?.kind === 'trip') {
    const trip = await prisma.trip.findFirst({
      where: { id: parsed.tripId, tenantId: parsed.tenantId },
      select: { id: true },
    });
    if (!trip) {
      return NextResponse.json({ error: 'trip_not_found' }, { status: 404 });
    }
  }

  try {
    const clerkUser = await currentUser();
    const displayName =
      clerkUser?.fullName ||
      clerkUser?.firstName ||
      clerkUser?.username ||
      clerkUser?.primaryEmailAddress?.emailAddress ||
      'Operator';
    const role = has({ role: 'org:admin' })
      ? 'admin'
      : has({ role: 'org:finance' })
        ? 'finance'
        : 'member';
    const session = requestedRoom
      ? await issueSession({
          userId,
          tenantId: tenant.id,
          displayName,
          avatarUrl: clerkUser?.imageUrl ?? null,
          role,
          roomIds: [requestedRoom],
        })
      : await identifySession({
          userId,
          tenantId: tenant.id,
          displayName,
          avatarUrl: clerkUser?.imageUrl ?? null,
          role,
          groupIds: [`role:${role}`],
        });
    return NextResponse.json({ ...session, role });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'session_failed', message: msg }, { status: 500 });
  }
}
