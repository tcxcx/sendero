/**
 * /dashboard/inbox/[tripId] — Phase B-δ: redirect to the canonical
 * console route.
 *
 * The scoped trip view used to mount its own MetaInboxLive copy with
 * the rail/conversation/stage/customer-panel grid embedded. After
 * Phase B-γ split that surface into parallel-routes slots on
 * `/dashboard/console`, two parallel implementations were live: the
 * sibling-slot layout on /dashboard/console and the embedded grid
 * here. Codex outside-voice review #4 flagged the duplication; this
 * route now redirects so /dashboard/console?tripId=… is the single
 * canonical scoped-trip surface.
 *
 * `<TripLiveblocks>` + `<TripComments>` (the trip-scoped Liveblocks
 * room and the comments aside) move into the console route's layout
 * so they continue to render when the operator lands here via a
 * legacy link or external deep-link.
 */

import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ tripId: string }> };

export default async function InboxTripPage({ params }: Props) {
  const { tripId } = await params;
  redirect(`/dashboard/console?tripId=${encodeURIComponent(tripId)}`);
}
