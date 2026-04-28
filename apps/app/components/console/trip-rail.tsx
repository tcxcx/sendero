'use client';

/**
 * Left-rail trip list for the MetaInbox console.
 *
 * Mirrors `/sendero/project/route-artboards.jsx::MetaInbox` left
 * column. Each row carries: channel icon + traveler name + timestamp
 * + tripId · route + last-message tail + state pill. The active row
 * gets a 2px vermillion edge stripe to its left, keyed on the
 * design's "active = surface-floating + shadow-sm" pattern.
 *
 * The ⌘K search bar is a controlled input that filters the visible
 * trip list locally on traveler name, route, tripId, and last-message
 * body. Cmd/Ctrl+K focuses it; Escape clears + blurs.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import Link from 'next/link';

import { asChannelKey, CHANNELS } from './channels';

export type TripState = 'AWAITING' | 'HOLD' | 'SETTLED' | 'OVER CAP' | 'SEARCH';

export interface TripRowData {
  id: string;
  who: string;
  route: string;
  state: TripState;
  /** Tone family — drives the state pill colour. */
  tone: 'verm' | 'sand' | 'sea' | 'outline';
  /** Short timestamp like "14:02" or "Yesterday". */
  mins: string;
  /** Last-message preview (single-line, truncated). */
  body: string;
  channel: string;
}

interface TripRailProps {
  trips: TripRowData[];
  activeTripId: string | null;
  /** When set, only the focused trip renders (deep-link / scoped). */
  scopedTripId?: string | null;
  /** When set, the channel-scope card replaces the tab+search header. */
  scopedChannel?: ReturnType<typeof CHANNELS extends Record<string, infer V> ? () => V : never>;
  /** Active state filter — null means "all". */
  stateFilter?: TripState | null;
  /** Toggling handler — clicking the active filter deselects it. */
  onStateFilterChange?: (state: TripState) => void;
  /**
   * Optional collapse-rail control. When provided, renders inline on the
   * AW/HD/ST count row right-justified — keeps the chevron in the visual
   * "rail header" line instead of overlapping the search input.
   */
  collapseControl?: React.ReactNode;
}

export function TripRail({
  trips,
  activeTripId,
  scopedTripId,
  scopedChannel,
  stateFilter = null,
  onStateFilterChange,
  collapseControl,
}: TripRailProps) {
  // Local search query — narrows the visible trip list on traveler
  // name, route, tripId, and last-message body. Group-trip + passenger
  // search will plug in here once those entities surface in the rail
  // data; the same `matchesQuery` predicate covers the new fields by
  // virtue of pulling everything off the row's text content.
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Cmd/Ctrl+K focuses the search; Escape clears + blurs. Mirrors the
  // pill copy ("⌘K") so the affordance matches the keyboard surface.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const filtered = useMemo(() => {
    const base = scopedTripId ? trips.filter(t => t.id === scopedTripId) : trips;
    const stateFiltered = stateFilter ? base.filter(t => t.state === stateFilter) : base;
    const q = query.trim().toLowerCase();
    if (!q) return stateFiltered;
    return stateFiltered.filter(t => matchesQuery(t, q));
  }, [trips, scopedTripId, query, stateFilter]);

  const visible = filtered;
  return (
    <div
      style={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
        minHeight: 0,
        flex: 1,
        overflow: 'hidden',
        background: 'var(--surface-floating)',
      }}
    >
      {scopedChannel ? (
        <div
          className="sd-card-flat"
          style={{
            padding: '8px 10px',
            background: 'transparent',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            {scopedChannel.icon(11)}
            <span className="t-meta" style={{ color: scopedChannel.accent, fontSize: 9 }}>
              Channel scope
            </span>
          </div>
          <div
            className="t-mono"
            style={{ marginTop: 3, color: scopedChannel.accent, fontSize: 10 }}
          >
            {scopedChannel.handle}
          </div>
        </div>
      ) : (
        <>
          {/* Compact count chips. Abbreviated labels (AW / HD / ST)
              fit in the 160px expanded rail without wrapping. Collapse
              chevron sits on the same row, right-justified. */}
          <div
            style={{
              display: 'flex',
              gap: 4,
              flexWrap: 'wrap',
              alignItems: 'center',
              padding: '0 4px',
              marginBottom: 8,
            }}
          >
            {(
              [
                { key: 'AWAITING', label: 'AW', cls: 'sd-pill-verm' },
                { key: 'HOLD', label: 'HD', cls: 'sd-pill-sand' },
                { key: 'SETTLED', label: 'ST', cls: 'sd-pill-sea' },
              ] as const
            ).map(({ key, label, cls }) => {
              const count = trips.filter(t => t.state === key).length;
              const active = stateFilter === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onStateFilterChange?.(key)}
                  className={`sd-pill ${cls}`}
                  style={{
                    fontSize: 9,
                    padding: '2px 6px',
                    cursor: 'pointer',
                    border: 0,
                    fontFamily: 'inherit',
                    opacity: stateFilter !== null && !active ? 0.35 : 1,
                    outline: active ? '1.5px solid currentColor' : 'none',
                    outlineOffset: 1,
                    transition: 'opacity 120ms ease',
                  }}
                >
                  {label} · {count}
                </button>
              );
            })}
            {collapseControl ? <span style={{ marginLeft: 'auto' }}>{collapseControl}</span> : null}
          </div>
          <div
            style={{
              borderTop: '1px solid var(--hairline-color-soft, rgba(31,42,68,0.08))',
              borderBottom: '1px solid var(--hairline-color-soft, rgba(31,42,68,0.08))',
              borderRight: '1px solid var(--ink)',
              padding: '5px 10px',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'rgba(253,251,247,0.6)',
            }}
          >
            <span className="t-mono ink-60" style={{ fontSize: 9, flexShrink: 0 }}>
              ⌘K
            </span>
            <input
              ref={inputRef}
              // type=text (not search) to avoid the browser's built-in
              // ::-webkit-search-cancel-button ✕ — we render our own
              // clear button right after this input so the two would
              // overlap. Aria-role still flags this as search.
              type="text"
              role="searchbox"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') {
                  setQuery('');
                  e.currentTarget.blur();
                }
              }}
              placeholder="Search trips…"
              aria-label="Search trips, destinations, passengers, group names"
              style={{
                flex: 1,
                minWidth: 0,
                background: 'transparent',
                border: 0,
                outline: 'none',
                fontFamily: 'var(--font-sans)',
                fontSize: 11,
                color: 'var(--midnight)',
                padding: 0,
              }}
            />
            {query ? (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  inputRef.current?.focus();
                }}
                aria-label="Clear search"
                className="t-mono ink-60"
                style={{
                  border: 0,
                  background: 'transparent',
                  padding: 0,
                  fontSize: 11,
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                ✕
              </button>
            ) : null}
          </div>
        </>
      )}
      <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        {visible.length === 0 ? (
          <RailEmpty scoped={Boolean(scopedTripId)} searching={Boolean(query.trim())} />
        ) : null}
        {visible.map((t, i) => {
          const active = t.id === activeTripId;
          const tc = CHANNELS[asChannelKey(t.channel)];
          return (
            <Link
              key={t.id}
              href={`/dashboard/console?tripId=${t.id}`}
              style={{
                padding: '10px 12px',
                background: active ? 'var(--tint-vermillion-soft)' : 'transparent',
                borderLeft: active ? '3px solid var(--vermillion)' : '3px solid transparent',
                borderTop:
                  i > 0 ? '1px solid var(--hairline-color-soft, rgba(31,42,68,0.08))' : 'none',
                cursor: 'pointer',
                textDecoration: 'none',
                color: 'inherit',
                display: 'block',
                minWidth: 0,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  gap: 6,
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    minWidth: 0,
                    flex: 1,
                  }}
                >
                  {tc.icon(10)}
                  <span
                    className="t-body"
                    style={{
                      fontWeight: 500,
                      fontSize: 11,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {t.who}
                  </span>
                </span>
                <span className="t-mono ink-60" style={{ fontSize: 9, flexShrink: 0 }}>
                  {t.mins}
                </span>
              </div>
              <div
                className="t-mono ink-60"
                style={{
                  marginTop: 2,
                  fontSize: 9,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {t.id} · {t.route}
              </div>
              <div
                className="t-body ink-70"
                style={{
                  marginTop: 3,
                  fontSize: 11,
                  lineHeight: 1.4,
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {t.body}
              </div>
              <div style={{ marginTop: 5 }}>
                <StateChip state={t.state} tone={t.tone} />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function RailEmpty({ scoped, searching }: { scoped: boolean; searching: boolean }) {
  const title = searching ? 'No matches' : scoped ? 'No match' : 'No trips yet';
  const body = searching
    ? 'Try a shorter query, a tripId fragment, or a destination keyword.'
    : scoped
      ? 'Pop back to the console to see all trips.'
      : 'Trips appear when a traveler messages on a connected channel.';
  return (
    <div
      style={{
        padding: '18px 8px',
        textAlign: 'center',
        color: 'rgba(31,42,68,0.55)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div
        aria-hidden
        style={{
          width: 28,
          height: 28,
          borderRadius: 14,
          background: 'var(--tint-vermillion-soft)',
          color: 'var(--vermillion)',
          display: 'grid',
          placeItems: 'center',
          fontSize: 14,
          margin: '0 auto',
        }}
      >
        ◇
      </div>
      <div className="t-body" style={{ fontSize: 11, fontWeight: 500, color: 'var(--midnight)' }}>
        {title}
      </div>
      <div className="t-body ink-70" style={{ fontSize: 10, lineHeight: 1.4 }}>
        {body}
      </div>
    </div>
  );
}

/**
 * Lower-cased substring match across every text field on a trip row.
 * Splitting the query on whitespace lets the operator combine tokens
 * ("aw lhr" matches an awaiting LHR trip). When group-trip + passenger
 * fields land on TripRowData, drop them into the haystack here too —
 * the predicate already ANDs across whitespace tokens, so adding
 * fields just widens the surface.
 */
function matchesQuery(t: TripRowData, q: string): boolean {
  const haystack = `${t.who} ${t.route} ${t.id} ${t.body} ${t.channel} ${t.state}`.toLowerCase();
  return q.split(/\s+/).every(token => haystack.includes(token));
}

function StateChip({ state, tone }: { state: TripState; tone: TripRowData['tone'] }) {
  return (
    <span
      className={`sd-pill sd-pill-${tone}`}
      style={{ fontSize: 8, padding: '1px 5px', fontWeight: 600, letterSpacing: '0.05em' }}
    >
      {state}
    </span>
  );
}
