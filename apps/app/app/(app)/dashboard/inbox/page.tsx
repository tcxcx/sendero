/**
 * /dashboard/inbox — stacked-thread list.
 *
 * Lands operators on a list of recent trip threads (design canvas
 * `InboxListA`). Click a row → `/dashboard/console?tripId=…` (the
 * detail surface migrated to the parallel-routes layout in Phase B-δ
 * — `/dashboard/inbox/[tripId]` now redirects through to the same
 * URL, so existing links still resolve).
 */
import { InboxStackedList } from '@/components/inbox/inbox-stacked-list';
import { loadConsoleTrips } from '@/lib/console-trips';
import { requireRole } from '@/lib/require-role';
import { requireCurrentTenant } from '@/lib/tenant-context';

export const dynamic = 'force-dynamic';

export default async function InboxIndexPage() {
  await requireRole('org:admin', { fallback: '/' });
  const { tenant } = await requireCurrentTenant();
  const trips = await loadConsoleTrips(tenant.id, null);

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col">
      <InboxStackedList trips={trips} />
    </div>
  );
}
