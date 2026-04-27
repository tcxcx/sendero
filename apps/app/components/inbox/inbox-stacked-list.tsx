'use client';

/**
 * Trip inbox stacked-thread list. Lands on `/dashboard/inbox` and
 * renders one row per trip with traveler initial, title (who), tripId,
 * subtitle (route + last-message preview), state chip, and timestamp.
 *
 * Source of truth: design canvas `InboxListA`
 * (sendero/project/route-artboards.jsx::InboxListA, lines 1679-1730).
 *
 * Click a row → `/dashboard/inbox/[tripId]` for the composer detail.
 *
 * Status pills filter the visible rows in-process; ⌘K focuses the
 * search input. Filtering is local — the server fetches the same 12
 * recent trips that the operator console rail uses (loadConsoleData).
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import Link from 'next/link';

import type { TripRowData, TripState } from '@/components/console/trip-rail';

interface Props {
  trips: TripRowData[];
}

type Filter = 'all' | 'awaiting' | 'settled' | 'holds';

function matchesFilter(t: TripRowData, f: Filter): boolean {
  if (f === 'all') return true;
  if (f === 'awaiting') return t.state === 'AWAITING' || t.state === 'OVER CAP';
  if (f === 'settled') return t.state === 'SETTLED';
  if (f === 'holds') return t.state === 'HOLD';
  return true;
}

function matchesQuery(t: TripRowData, q: string): boolean {
  if (!q.trim()) return true;
  const needle = q.trim().toLowerCase();
  return (
    t.id.toLowerCase().includes(needle) ||
    t.who.toLowerCase().includes(needle) ||
    t.route.toLowerCase().includes(needle) ||
    t.body.toLowerCase().includes(needle)
  );
}

function StateChip({ state, tone }: { state: TripState; tone: TripRowData['tone'] }) {
  const bg =
    tone === 'verm'
      ? 'color-mix(in oklab, var(--ink) 14%, transparent)'
      : tone === 'sea'
        ? 'color-mix(in oklab, var(--midnight) 8%, transparent)'
        : tone === 'sand'
          ? 'color-mix(in oklab, #d4a056 22%, transparent)'
          : 'transparent';
  const fg =
    tone === 'verm'
      ? 'var(--ink)'
      : tone === 'sea'
        ? 'var(--midnight)'
        : tone === 'sand'
          ? '#8a5a1a'
          : 'var(--midnight)';
  const border =
    tone === 'outline' ? 'inset 0 0 0 1px var(--hairline-color)' : 'inset 0 0 0 1px transparent';
  return (
    <span
      className="font-mono text-[10px] uppercase tracking-[0.08em]"
      style={{
        background: bg,
        color: fg,
        boxShadow: border,
        padding: '4px 10px',
        borderRadius: 999,
        whiteSpace: 'nowrap',
      }}
    >
      {state}
    </span>
  );
}

export function InboxStackedList({ trips }: Props) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const counts = useMemo(
    () => ({
      all: trips.length,
      awaiting: trips.filter(t => t.state === 'AWAITING' || t.state === 'OVER CAP').length,
      settled: trips.filter(t => t.state === 'SETTLED').length,
      holds: trips.filter(t => t.state === 'HOLD').length,
    }),
    [trips]
  );

  const visible = useMemo(
    () => trips.filter(t => matchesFilter(t, filter) && matchesQuery(t, query)),
    [trips, filter, query]
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 px-6 py-4">
      {/* Search bar with status pills */}
      <div
        className="flex items-center gap-3 rounded-[var(--radius-md)] px-4 py-2.5"
        style={{
          background: 'var(--surface-raised)',
          boxShadow: 'inset 0 0 0 1px var(--hairline-color)',
        }}
      >
        <span
          className="font-mono text-[10px] uppercase tracking-[0.08em]"
          style={{ color: 'color-mix(in oklab, var(--midnight) 60%, transparent)' }}
        >
          ⌘K
        </span>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search trips, threads, PNRs…"
          className="flex-1 border-0 bg-transparent text-sm outline-none placeholder:text-[color:color-mix(in_oklab,var(--midnight)_50%,transparent)]"
        />
        <FilterPill
          label="All"
          count={counts.all}
          active={filter === 'all'}
          onClick={() => setFilter('all')}
          tone="outline"
        />
        <FilterPill
          label="Awaiting"
          count={counts.awaiting}
          active={filter === 'awaiting'}
          onClick={() => setFilter('awaiting')}
          tone="verm"
        />
        <FilterPill
          label="Settled"
          count={counts.settled}
          active={filter === 'settled'}
          onClick={() => setFilter('settled')}
          tone="sea"
        />
        <FilterPill
          label="Holds"
          count={counts.holds}
          active={filter === 'holds'}
          onClick={() => setFilter('holds')}
          tone="sand"
        />
      </div>

      {/* Stacked thread list */}
      <div
        className="flex min-h-0 flex-1 flex-col overflow-auto rounded-[var(--radius-lg)]"
        style={{
          background: 'var(--surface-floating, var(--surface-raised))',
          boxShadow: 'var(--shadow-md)',
        }}
      >
        {visible.length === 0 ? (
          <div className="flex flex-1 items-center justify-center p-12 text-sm text-muted-foreground">
            No trips match this filter.
          </div>
        ) : (
          visible.map((t, i) => (
            <Link
              key={t.id}
              href={`/dashboard/inbox/${t.id}`}
              className="relative flex items-center gap-4 border-b border-[color:var(--hairline-color-soft)] px-6 py-4 no-underline transition-colors last:border-b-0 hover:bg-[color:color-mix(in_oklab,var(--ink)_3%,transparent)]"
            >
              {(t.state === 'AWAITING' || t.state === 'HOLD' || t.state === 'OVER CAP') && (
                <div
                  aria-hidden
                  className="absolute inset-y-0 left-0 w-[2px]"
                  style={{ background: 'var(--ink)' }}
                />
              )}
              <Avatar name={t.who} />
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-baseline gap-3">
                  <span className="truncate text-[15px] font-medium text-[color:var(--midnight)]">
                    {t.who}
                  </span>
                  <span className="font-mono text-[11px] text-[color:color-mix(in_oklab,var(--midnight)_55%,transparent)]">
                    {t.id.slice(0, 10)}
                    {t.id.length > 10 ? '…' : ''}
                  </span>
                </div>
                <div className="mt-0.5 truncate text-[13px] text-[color:color-mix(in_oklab,var(--midnight)_70%,transparent)]">
                  {t.route !== '—' ? `${t.route} · ` : ''}
                  {t.body}
                </div>
              </div>
              <StateChip state={t.state} tone={t.tone} />
              <span className="font-mono text-[11px] text-[color:color-mix(in_oklab,var(--midnight)_55%,transparent)]">
                {t.mins}
              </span>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}

function FilterPill({
  label,
  count,
  active,
  onClick,
  tone,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  tone: 'verm' | 'sea' | 'sand' | 'outline';
}) {
  const bg = active
    ? tone === 'verm'
      ? 'var(--ink)'
      : tone === 'sea'
        ? 'var(--midnight)'
        : tone === 'sand'
          ? '#d4a056'
          : 'var(--midnight)'
    : 'transparent';
  const fg = active ? '#fdfbf7' : 'var(--midnight)';
  const border = active ? 'inset 0 0 0 1px transparent' : 'inset 0 0 0 1px var(--hairline-color)';
  return (
    <button
      type="button"
      onClick={onClick}
      className="font-mono text-[10px] uppercase tracking-[0.08em] transition-colors"
      style={{
        background: bg,
        color: fg,
        boxShadow: border,
        padding: '4px 10px',
        borderRadius: 999,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {label} · {count}
    </button>
  );
}

function Avatar({ name }: { name: string }) {
  const initial = name.trim().charAt(0).toUpperCase() || '·';
  return (
    <div
      className="grid h-9 w-9 shrink-0 place-items-center rounded-full font-serif text-[15px] font-medium"
      style={{
        background: 'var(--surface-raised)',
        boxShadow: 'inset 0 0 0 1px var(--hairline-color)',
        color: 'var(--midnight)',
      }}
    >
      {initial}
    </div>
  );
}
