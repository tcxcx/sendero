/**
 * Phase B — `@threads` parallel-routes slot.
 *
 * Server-fetches the 12-most-recent trips and renders the InboxRail.
 * Streams in independently of the conversation column (children) and
 * the right-side context drawer (`@context`), so the operator's
 * "what's in flight" snapshot paints as soon as the trip query lands
 * without waiting on the focused-trip events JSON.
 *
 * The rail's expand/collapse + chat-mode toggle stay client-side
 * inside InboxRail. URL state (`?tripId`) drives the active row, so
 * a click here re-renders the conversation slot with no shared
 * client-side store needed.
 */

import { InboxRail } from '@/components/console/inbox-rail';
import { asChannelKey, CHANNELS } from '@/components/console/channels';
import { loadConsoleTrips } from '@/lib/console-trips';
import { requireCurrentTenant } from '@/lib/tenant-context';

interface ThreadsSlotProps {
  searchParams: Promise<{ tripId?: string }>;
}

export const dynamic = 'force-dynamic';

export default async function ThreadsSlot({ searchParams }: ThreadsSlotProps) {
  const params = await searchParams;
  const scopedTripId = params.tripId ?? null;
  const { tenant } = await requireCurrentTenant();
  const trips = await loadConsoleTrips(tenant.id, scopedTripId);

  // Active row resolution mirrors the previous in-MetaInbox behavior:
  // the scoped trip wins, otherwise the freshest trip is highlighted.
  const activeTripId = scopedTripId ?? trips[0]?.id ?? null;
  const focused = scopedTripId ? trips.find(t => t.id === scopedTripId) : null;
  const scopedChannel = focused ? CHANNELS[asChannelKey(focused.channel)] : undefined;

  return (
    <InboxRail
      trips={trips}
      activeTripId={activeTripId}
      scopedTripId={scopedTripId}
      scopedChannel={scopedChannel}
    />
  );
}
