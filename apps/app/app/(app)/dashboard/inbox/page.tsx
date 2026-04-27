/**
 * /dashboard/inbox — stacked-thread list.
 *
 * Lands operators on a list of recent trip threads (design canvas
 * `InboxListA`). Click a row → `/dashboard/inbox/[tripId]` for the
 * scoped composer detail. Replaces the previous redirect-to-console
 * shortcut so the inbox surface stops doubling as the AI command
 * console — one route, one job.
 */
import { InboxStackedList } from '@/components/inbox/inbox-stacked-list';
import { loadConsoleData } from '@/lib/console-data';
import { requireRole } from '@/lib/require-role';
import { requireCurrentTenant } from '@/lib/tenant-context';

export const dynamic = 'force-dynamic';

export default async function InboxIndexPage() {
  await requireRole('org:admin', { fallback: '/' });
  const { tenant } = await requireCurrentTenant();
  const { trips } = await loadConsoleData(tenant.id, null);

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col">
      <InboxStackedList trips={trips} />
    </div>
  );
}
