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
 * Phase B — the parallel-routes layout splits the surface into four
 * server-streamed segments:
 *   - `@kpis`   — workspace KPI strip (top, unscoped only)
 *   - `@threads` — InboxRail (left, server-fetches trips)
 *   - children  (this page) — MetaInbox conversation + stage + composer
 *   - `@context` — trip-context drawer (right aside, ≥lg)
 *
 * This page is now responsible only for the focused-trip data the
 * conversation column needs. Trips and KPIs land via their slots.
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

  // `loadConsoleData` still returns the full payload because the
  // ConsoleHero (workspace mode) reads `trips` for its avatar row,
  // and MetaInboxLive's chat-bridge wiring still expects the trip
  // list. The @threads slot performs an independent server fetch
  // (parallel routes can't share data via React props), which is
  // the trade we're making for independent streaming. The duplicate
  // `prisma.trip.findMany` is a 12-row query — acceptable cost.
  const { trips, conversation, traveler, holdExpires, pendingBooking, kpis } =
    await loadConsoleData(tenant.id, scopedTripId);

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col">
      <MetaInboxLive
        trips={trips}
        scopedTripId={scopedTripId}
        initialConversation={conversation}
        traveler={traveler}
        holdExpires={holdExpires}
        pendingBooking={pendingBooking}
        kpis={kpis}
        hideKpiStrip
        embedRail={false}
      />
    </div>
  );
}
