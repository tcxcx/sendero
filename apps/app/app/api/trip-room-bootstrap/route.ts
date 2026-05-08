/**
 * Phase C-1 — trip-room bootstrap endpoint.
 *
 * The console layout's `<ConsoleTripRoomBridge>` (a client component
 * that reads `?tripId` via nuqs) calls this endpoint to obtain the
 * server-computed inputs `<TripRoomProvider>` needs:
 *
 *   - `roomId` — derived from `(tenantId, tripId)` via `roomIdForTrip`
 *   - `initialPresence` — Clerk-resolved display name + role + tripId
 *   - side-effect: `ensureRoom()` fires `getOrCreateRoom` against
 *     Liveblocks (idempotent, fire-and-forget via `after()`)
 *
 * Layouts in Next.js can't see `searchParams`, so we cannot compute
 * these inputs in the server layout itself. The endpoint exposes them
 * to the client bridge that does see the URL.
 *
 * Auth gates:
 *   - 401 when no Clerk session or no active organization
 *   - 403 when the resolved tenant doesn't own the requested trip
 *   - 404 when the trip id is unknown
 *   - 200 + `{roomId, initialPresence}` on success
 *
 * `ensureRoom` failures are swallowed (existing pattern in
 * `dashboard/layout.tsx`'s workspace-room bootstrap). The Liveblocks
 * SDK falls back to "skip when secret unset" so dev without the env
 * var stays functional.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';

import { auth } from '@clerk/nextjs/server';
import { ensureRoom, roomIdForTrip } from '@sendero/collaboration/server';
import { prisma } from '@sendero/database';

import { buildInitialPresence } from '@/lib/collaboration-presence';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 10;

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { tripId?: string } | null;
  const tripId = typeof body?.tripId === 'string' ? body.tripId : null;
  if (!tripId) {
    return NextResponse.json({ error: 'invalid_tripId' }, { status: 400 });
  }

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

  // Verify the trip belongs to this tenant. The query is a cheap
  // existence check — same shape as `dashboard/inbox/[tripId]/page.tsx`
  // used pre-B-δ. Cross-tenant access yields 403, not 404, so the
  // client distinguishes "wrong workspace" from "trip deleted."
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: { id: true, tenantId: true },
  });
  if (!trip) {
    return NextResponse.json({ error: 'trip_not_found' }, { status: 404 });
  }
  if (trip.tenantId !== tenant.id) {
    return NextResponse.json({ error: 'tenant_forbidden' }, { status: 403 });
  }

  const roomId = roomIdForTrip(tenant.id, tripId);
  const initialPresence = await buildInitialPresence({
    userId,
    focusedSection: 'handoff',
    tripId,
    focusLabel: 'support handoff',
  });

  // Fire-and-forget room bootstrap so the response stays cheap. Same
  // pattern as `dashboard/layout.tsx`'s workspace-room call. Liveblocks
  // `getOrCreateRoom` is idempotent server-side; rapid `?tripId`
  // switching produces N background calls, all no-ops on the second
  // through N-th invocation per room id.
  after(() => ensureRoom({ tenantId: tenant.id, tripId }));

  return NextResponse.json({ roomId, initialPresence });
}
