/**
 * /dashboard/inbox/[tripId] — MetaInbox scoped to one trip.
 *
 * Per the design canvas (`route-artboards.jsx::InboxDetailA`), the trip
 * inbox is the same MetaInbox component as the agent console, rendered
 * in scoped mode so the header, composer, and customer bubbles tint
 * to the trip's channel.
 */

import { notFound } from 'next/navigation';
import { after } from 'next/server';

import { roomIdForTrip } from '@sendero/collaboration/rooms';
import { ensureRoom } from '@sendero/collaboration/server';
import { prisma } from '@sendero/database';

import { TripComments } from '@/components/collaboration/trip-comments';
import { TripLiveblocks } from '@/components/collaboration/trip-liveblocks';
import { MetaInboxLive } from '@/components/console/meta-inbox-live';
import { buildInitialPresence } from '@/lib/collaboration-presence';
import { loadConsoleData } from '@/lib/console-data';
import { requireCurrentTenant } from '@/lib/tenant-context';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ tripId: string }> };

export default async function InboxTripPage({ params }: Props) {
  const { tripId } = await params;
  const { tenant, userId } = await requireCurrentTenant();

  // Cheap existence check — `loadConsoleData` will fetch again, but a
  // 404 here gives a real Next.js notFound() instead of a blank rail.
  const exists = await prisma.trip.findFirst({
    where: { id: tripId, tenantId: tenant.id },
    select: { id: true },
  });
  if (!exists) notFound();

  const { trips, conversation, traveler, holdExpires, pendingBooking, kpis } =
    await loadConsoleData(tenant.id, tripId);
  const liveblocksEnabled = Boolean(process.env.LIVEBLOCKS_SECRET_KEY);
  const tripRoomId = roomIdForTrip(tenant.id, tripId);
  const initialPresence = liveblocksEnabled
    ? await buildInitialPresence({
        userId,
        focusedSection: 'handoff',
        tripId,
        focusLabel: 'support handoff',
      })
    : null;

  if (liveblocksEnabled) {
    after(() => ensureRoom({ tenantId: tenant.id, tripId }));
  }

  const content = (
    <div className="grid h-full min-h-0 w-full flex-1 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-h-0 min-w-0">
        <MetaInboxLive
          trips={trips}
          scopedTripId={tripId}
          initialConversation={conversation}
          traveler={traveler}
          holdExpires={holdExpires}
          pendingBooking={pendingBooking}
          kpis={kpis}
        />
      </div>
      {liveblocksEnabled ? (
        <aside className="min-h-0 overflow-auto pr-3 pb-3">
          <TripComments tripId={tripId} />
        </aside>
      ) : null}
    </div>
  );

  if (!liveblocksEnabled || !initialPresence) {
    return content;
  }

  return (
    <TripLiveblocks roomId={tripRoomId} tripId={tripId} initialPresence={initialPresence}>
      {content}
    </TripLiveblocks>
  );
}
