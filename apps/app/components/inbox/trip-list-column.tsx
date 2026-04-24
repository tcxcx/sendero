'use client';

/**
 * TripListColumn — fixed 20rem trip-thread rail for the inbox layout.
 *
 * Replaces the previous shadcn dual-Sidebar pattern. Renders as a plain
 * border-right column inside the app shell's main content area. No
 * SidebarProvider, no nested context — just a list of tenant trips,
 * an active-state highlight from the route, and a filter.
 *
 * Motion: property-specific transitions under 200ms for rail + row
 * hover. No scale-from-zero. No decorative animation on repeated picks.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo, useState } from 'react';

import { ChannelBadge, type ChannelKindSlug } from '@/components/inbox/channel-badge';
import { Input } from '@/components/ui/input';

export type InboxTripRow = {
  id: string;
  status: string;
  title: string;
  teaser: string;
  updatedLabel: string;
  channel?: ChannelKindSlug;
  unread?: boolean;
};

export function TripListColumn({ trips }: { trips: InboxTripRow[] }) {
  const pathname = usePathname() ?? '';
  const selectedId = pathname.startsWith('/app/inbox/') ? pathname.split('/').pop() : null;
  const [q, setQ] = useState('');
  const [onlyUnread, setOnlyUnread] = useState(false);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = trips;
    if (needle) {
      list = list.filter(
        t =>
          t.title.toLowerCase().includes(needle) ||
          t.teaser.toLowerCase().includes(needle) ||
          t.id.includes(needle)
      );
    }
    if (onlyUnread) list = list.filter(t => t.unread);
    return list;
  }, [q, onlyUnread, trips]);

  return (
    // Borderless: floats on parchment, no right rule. Rows are raised
    // cards with shadow on hover / floating on select (DESIGN.md §19).
    <aside
      style={{ width: '20rem' }}
      className="flex shrink-0 flex-col bg-[color:var(--surface-base)] px-3 py-3"
    >
      <div className="flex flex-col gap-2 px-1 pb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-medium text-foreground">Trip threads</div>
          <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
            <input
              type="checkbox"
              className="size-3 rounded-sm accent-[color:var(--ink)]"
              checked={onlyUnread}
              onChange={e => setOnlyUnread(e.target.checked)}
            />
            Unread
          </label>
        </div>
        <Input
          placeholder="Filter trips…"
          className="h-8 border-0 bg-[color:var(--surface-raised)] text-xs shadow-[var(--shadow-xs)]"
          value={q}
          onChange={e => setQ(e.target.value)}
        />
      </div>
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-1 pb-2">
        {filtered.length === 0 ? (
          <div className="px-3 py-6 text-xs text-muted-foreground">
            {trips.length === 0
              ? 'No trips yet. Create a prepaid trip from Trips, then return here to support travelers in-channel.'
              : 'No trips match. Clear the filter or toggle unread off.'}
          </div>
        ) : null}
        {filtered.map(trip => {
          const active = selectedId === trip.id;
          return (
            <Link
              key={trip.id}
              href={`/app/inbox/${trip.id}`}
              aria-current={active ? 'page' : undefined}
              className={
                'group relative flex cursor-pointer flex-col gap-1 overflow-hidden rounded-[var(--radius-md)] px-3 py-3 text-sm leading-tight transition-[box-shadow,background-color] duration-[240ms] ease-[cubic-bezier(0.23,1,0.32,1)] ' +
                (active
                  ? 'bg-[color:var(--surface-floating)] shadow-[var(--shadow-lg)] ' +
                    'before:absolute before:inset-y-2 before:left-1 before:w-0.5 before:rounded-full before:bg-[color:var(--ink)] before:content-[""]'
                  : 'bg-[color:var(--surface-raised)] shadow-[var(--shadow-xs)] hover:shadow-[var(--shadow-md)]')
              }
            >
              <div className="flex w-full min-w-0 items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-medium">{trip.title}</span>
                <span className="ml-auto shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                  {trip.updatedLabel}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {trip.channel ? <ChannelBadge channel={trip.channel} size="xs" /> : null}
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                  {trip.status}
                </span>
                {trip.unread ? (
                  <span className="ml-auto size-1.5 shrink-0 rounded-full bg-[color:var(--ink)]" />
                ) : null}
              </div>
              <span className="line-clamp-2 whitespace-break-spaces text-xs text-muted-foreground">
                {trip.teaser}
              </span>
            </Link>
          );
        })}
      </div>
    </aside>
  );
}
