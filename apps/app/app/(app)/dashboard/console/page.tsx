/**
 * /dashboard/console — the canonical MetaInbox.
 *
 * Two modes routed by `?tripId=`:
 *   - Unscoped: operator ↔ Sendero AI. INTERNAL · OPERATOR watermark,
 *     midnight Sendero-AI header, terminal composer.
 *   - Scoped:   operator ↔ traveler via the trip's primary channel.
 *     Channel-tinted header, customer-bubble messages tagged with
 *     "via {channel} · {time}", channel-tinted composer.
 *
 * Server-side fetch lives in `@/lib/console-data` so the inbox routes
 * share the same shape.
 */

import { MetaInboxLive } from '@/components/console/meta-inbox-live';
import { loadConsoleData } from '@/lib/console-data';
import { requireCurrentTenant } from '@/lib/tenant-context';

export const dynamic = 'force-dynamic';

interface ConsolePageProps {
  searchParams: Promise<{ tripId?: string }>;
}

export default async function ConsolePage(props: ConsolePageProps) {
  const params = await props.searchParams;
  const scopedTripId = params.tripId ?? null;
  const { tenant } = await requireCurrentTenant();

  const { trips, conversation, traveler, holdExpires, pendingBooking } = await loadConsoleData(
    tenant.id,
    scopedTripId
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col">
      <MetaInboxLive
        trips={trips}
        scopedTripId={scopedTripId}
        initialConversation={conversation}
        traveler={traveler}
        holdExpires={holdExpires}
        pendingBooking={pendingBooking}
      />
    </div>
  );
}
