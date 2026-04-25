/**
 * /dashboard/inbox — MetaInbox in unscoped mode.
 *
 * The sidebar's "Trip inboxes" entry lands here. With no `tripId` the
 * MetaInbox shows operator ↔ Sendero AI (internal mode) plus the
 * left rail of recent trips for click-into.
 */

import { MetaInboxLive } from '@/components/console/meta-inbox-live';
import { loadConsoleData } from '@/lib/console-data';
import { requireCurrentTenant } from '@/lib/tenant-context';

export const dynamic = 'force-dynamic';

export default async function InboxIndexPage() {
  const { tenant } = await requireCurrentTenant();
  const { trips, conversation, traveler, holdExpires } = await loadConsoleData(tenant.id, null);

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col">
      <MetaInboxLive
        trips={trips}
        scopedTripId={null}
        initialConversation={conversation}
        traveler={traveler}
        holdExpires={holdExpires}
      />
    </div>
  );
}
