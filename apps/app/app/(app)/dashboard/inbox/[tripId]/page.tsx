/**
 * /dashboard/inbox/[tripId] — MetaInbox scoped to one trip.
 *
 * Per the design canvas (`route-artboards.jsx::InboxDetailA`), the trip
 * inbox is the same MetaInbox component as the agent console, rendered
 * in scoped mode so the header, composer, and customer bubbles tint
 * to the trip's channel.
 */

import { notFound } from 'next/navigation';

import { prisma } from '@sendero/database';

import { MetaInboxLive } from '@/components/console/meta-inbox-live';
import { loadConsoleData } from '@/lib/console-data';
import { requireCurrentTenant } from '@/lib/tenant-context';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ tripId: string }> };

export default async function InboxTripPage({ params }: Props) {
  const { tripId } = await params;
  const { tenant } = await requireCurrentTenant();

  // Cheap existence check — `loadConsoleData` will fetch again, but a
  // 404 here gives a real Next.js notFound() instead of a blank rail.
  const exists = await prisma.trip.findFirst({
    where: { id: tripId, tenantId: tenant.id },
    select: { id: true },
  });
  if (!exists) notFound();

  const { trips, conversation, traveler, holdExpires, pendingBooking } = await loadConsoleData(
    tenant.id,
    tripId
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col">
      <MetaInboxLive
        trips={trips}
        scopedTripId={tripId}
        initialConversation={conversation}
        traveler={traveler}
        holdExpires={holdExpires}
        pendingBooking={pendingBooking}
      />
    </div>
  );
}
