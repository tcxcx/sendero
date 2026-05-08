'use client';

/**
 * InboxRail — collapsible inner sidebar wrapper around TripRail.
 *
 * Default state is collapsed (44px wide rail with an expand chevron +
 * stacked unread/awaiting counters). Click to expand to the full
 * TripRail (260px on scoped, 280px otherwise). Persists across mounts
 * via localStorage so a re-render doesn't pop the panel back open.
 *
 * Expanded state has two tabs:
 *   - TRIP INBOX (primary) — the live trip list. Default tab.
 *   - CHAT MODE             — past chat sessions. A trip can have a
 *                             chat history; a chat can be assigned to
 *                             a trip later. Histories stay separate so
 *                             the operator can re-view either.
 */

import { type ReactNode, useCallback, useEffect, useState } from 'react';

import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryState } from 'nuqs';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { TripRail, type TripRowData, type TripState } from './trip-rail';

const STORAGE_KEY = 'sendero.console.inboxRail.expanded';

// `scopedChannel` was declared on the original prop interface (carrying a
// CHANNELS lookup for the scoped trip) but never read inside the component.
// Server→client serialization fails because CHANNELS entries hold an `icon`
// React component (a function), so passing it from the @threads server
// component to this client component throws "Functions cannot be passed
// directly to Client Components" the moment any ?tripId= URL renders.
// Dropped to fix the regression.
interface InboxRailProps {
  trips: TripRowData[];
  activeTripId: string | null;
  scopedTripId: string | null;
}

export function InboxRail(props: InboxRailProps) {
  const [expanded, setExpanded] = useState(false);
  // Persists across expand/collapse so selecting AW then opening the
  // full rail keeps the filter active.
  const [stateFilter, setStateFilter] = useState<TripState | null>(null);
  const toggleStateFilter = useCallback(
    (state: TripState) => setStateFilter(prev => (prev === state ? null : state)),
    []
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === '1') setExpanded(true);
  }, []);

  const toggle = useCallback(() => {
    setExpanded(next => {
      const v = !next;
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(STORAGE_KEY, v ? '1' : '0');
      }
      return v;
    });
  }, []);

  if (expanded) {
    return (
      <ExpandedRail>
        <Tabs defaultValue="trips" className="flex h-full min-h-0 flex-col">
          <TabsList className="mb-1 h-7 w-full justify-stretch bg-transparent p-0 gap-1">
            <TabsTrigger
              value="trips"
              className="flex-1 h-7 rounded-sm bg-[color-mix(in_oklab,var(--ink)_8%,transparent)] data-[state=active]:bg-[var(--ink)] data-[state=active]:text-white"
            >
              Trip inbox
            </TabsTrigger>
            <TabsTrigger
              value="chats"
              className="flex-1 h-7 rounded-sm bg-[color-mix(in_oklab,var(--ink)_4%,transparent)] data-[state=active]:bg-[var(--ink)] data-[state=active]:text-white"
            >
              Chat mode
            </TabsTrigger>
          </TabsList>
          <TabsContent value="trips" className="mt-0 flex-1 min-h-0 overflow-hidden">
            <TripRail
              {...props}
              stateFilter={stateFilter}
              onStateFilterChange={toggleStateFilter}
              collapseControl={<CollapseRailButton onClick={toggle} />}
            />
          </TabsContent>
          <TabsContent value="chats" className="mt-0 flex-1 min-h-0 overflow-auto">
            <ChatHistoryList />
          </TabsContent>
        </Tabs>
      </ExpandedRail>
    );
  }

  return (
    <CollapsedRail
      trips={props.trips}
      activeTripId={props.activeTripId}
      stateFilter={stateFilter}
      onStateFilterChange={toggleStateFilter}
      toggle={toggle}
    />
  );
}

/**
 * CHAT MODE tab — recent operator chat sessions.
 *
 * Fetches /api/chats/list (operator-scoped by default) and renders
 * each session as a tap target: title (or first user-message snippet),
 * last-message preview, message count, optional trip pill if attached.
 * Clicking a session deep-links into `/dashboard/console?cs=<id>`
 * (handler for resume lives in MetaInboxLive when the URL flag lands).
 */
interface ChatSessionRow {
  id: string;
  title: string;
  tripId: string | null;
  messageCount: number;
  lastMessage: { role: string; content: string; at: string } | null;
  createdAt: string;
  updatedAt: string;
}

function ChatHistoryList() {
  const [sessions, setSessions] = useState<ChatSessionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // `cs` lives in the URL so reloads / shared links resume. nuqs
  // defaults to shallow (history.replaceState) so clicks don't
  // re-fetch the dashboard RSC tree or fire the loading.tsx overlay.
  const [activeCs] = useQueryState('cs');
  const router = useRouter();

  // Stable refetch fn — pulled out so the SSE subscriber + intra-tab
  // BroadcastChannel listener can both call it. `useCallback` so the
  // effect deps below stay stable across renders.
  const refetch = useCallback(async () => {
    try {
      const res = await fetch('/api/chats/list?scope=mine&limit=30', {
        cache: 'no-store',
      });
      if (!res.ok) {
        setError(`Failed to load chats (${res.status})`);
        return;
      }
      const data = (await res.json()) as { sessions?: ChatSessionRow[] };
      setSessions(data.sessions ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load chats');
    }
  }, []);

  // Initial load.
  useEffect(() => {
    void refetch();
  }, [refetch]);

  // Real-time push: server emits pg_notify('chat_session_updated', …)
  // after every persisted turn; /api/chats/stream re-broadcasts via
  // SSE. Refetch on each event so the list updates without polling.
  useEffect(() => {
    const es = new EventSource('/api/chats/stream');
    const onUpdate = () => {
      void refetch();
    };
    es.addEventListener('chat_session_updated', onUpdate);
    // `poll` events fire when DATABASE_URL_UNPOOLED is missing — the
    // server falls back to a slow keep-alive. Use them as a refetch
    // trigger so dev-local without unpooled still updates.
    es.addEventListener('poll', onUpdate);
    es.onerror = () => {
      // EventSource auto-reconnects; just refetch on hiccup so we
      // catch up if any events landed during the gap.
      void refetch();
    };
    return () => {
      es.removeEventListener('chat_session_updated', onUpdate);
      es.removeEventListener('poll', onUpdate);
      es.close();
    };
  }, [refetch]);

  // Intra-tab signal: MetaInboxLive's onFinish fires a
  // BroadcastChannel('sendero.chat-session.updated') after every turn,
  // which gives sub-100ms refresh on the same browser tab even before
  // the SSE round-trip lands.
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const bc = new BroadcastChannel('sendero.chat-session.updated');
    const onMsg = () => {
      void refetch();
    };
    bc.addEventListener('message', onMsg);
    return () => {
      bc.removeEventListener('message', onMsg);
      bc.close();
    };
  }, [refetch]);

  if (error) {
    return (
      <div style={{ padding: '14px 8px', fontSize: 10, color: 'var(--vermillion)' }}>{error}</div>
    );
  }
  if (sessions === null) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Loader2 size={16} color="var(--ink)" className="animate-spin" />
      </div>
    );
  }
  if (sessions.length === 0) {
    return (
      <div
        style={{
          padding: '14px 8px',
          textAlign: 'center',
          color: 'rgba(31,42,68,0.55)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <div
          aria-hidden
          style={{
            width: 28,
            height: 28,
            borderRadius: 14,
            background: 'color-mix(in oklab, var(--ink) 14%, transparent)',
            color: 'var(--ink)',
            display: 'grid',
            placeItems: 'center',
            fontSize: 13,
            margin: '0 auto',
          }}
        >
          ☉
        </div>
        <div className="t-body" style={{ fontSize: 11, fontWeight: 500, color: 'var(--midnight)' }}>
          No chats yet
        </div>
        <div className="t-body ink-70" style={{ fontSize: 10, lineHeight: 1.45 }}>
          Sessions appear here once you chat with Sendero AI. They survive trip detachment.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 0' }}>
      {sessions.map(s => (
        <button
          key={s.id}
          type="button"
          onClick={() => {
            // Set BOTH `cs` and `tripId` (when linked) via a real
            // navigation so `loadConsoleData` re-runs server-side and
            // the right column shows the linked trip's offers /
            // pending booking. Shallow nuqs updates skip RSC and
            // would leave the right column stale.
            const params = new URLSearchParams();
            params.set('cs', s.id);
            if (s.tripId) params.set('tripId', s.tripId);
            router.push(`/dashboard/console?${params.toString()}`);
          }}
          style={{
            display: 'block',
            width: '100%',
            padding: '8px 10px',
            borderRadius: 8,
            textDecoration: 'none',
            color: 'inherit',
            textAlign: 'left',
            background:
              activeCs === s.id ? 'color-mix(in oklab, var(--ink) 8%, transparent)' : 'transparent',
            border: 0,
            cursor: 'pointer',
            font: 'inherit',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 6,
              minWidth: 0,
            }}
          >
            <span
              className="t-body"
              style={{
                fontSize: 11,
                fontWeight: 500,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                flex: 1,
              }}
            >
              {s.title}
            </span>
            <span className="t-mono ink-60" style={{ fontSize: 9, flexShrink: 0 }}>
              {formatRelativeTime(s.updatedAt)}
            </span>
          </div>
          {s.lastMessage ? (
            <div
              className="t-body ink-70"
              style={{
                marginTop: 3,
                fontSize: 10,
                lineHeight: 1.4,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {s.lastMessage.content}
            </div>
          ) : null}
          <div
            style={{
              marginTop: 5,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              flexWrap: 'wrap',
            }}
          >
            <span
              className="t-mono"
              style={{
                fontSize: 8,
                padding: '1px 5px',
                borderRadius: 3,
                background: 'color-mix(in oklab, var(--ink) 12%, transparent)',
                color: 'var(--ink)',
                fontWeight: 600,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
              }}
            >
              {s.messageCount} msg
            </span>
            {s.tripId ? (
              <span
                className="t-mono"
                style={{
                  fontSize: 8,
                  padding: '1px 5px',
                  borderRadius: 3,
                  background: 'var(--tint-sea-soft)',
                  color: 'var(--sendero-sea, #0f7c82)',
                  fontWeight: 600,
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                }}
                title={`Linked to trip ${s.tripId}`}
              >
                · trip
              </span>
            ) : null}
          </div>
        </button>
      ))}
    </div>
  );
}

function formatRelativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'now';
  if (ms < 3600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86400_000) return `${Math.round(ms / 3600_000)}h`;
  return `${Math.round(ms / 86400_000)}d`;
}

// Wide enough that the Trip inbox / Chat mode tab triggers breathe
// (each pill needs ~90px to read comfortably at 10px uppercase).
// Trip rows still truncate for any extra fields.
const EXPANDED_WIDTH = 220;

function ExpandedRail({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        width: EXPANDED_WIDTH,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        overflow: 'hidden',
        background: 'var(--surface-floating)',
        borderRight: '1px solid var(--ink)',
      }}
    >
      {children}
    </div>
  );
}

export function CollapseRailButton({ onClick }: { onClick: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      aria-label="Collapse inbox rail"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: 22,
        height: 22,
        borderRadius: '50%',
        border: 0,
        background: hover ? 'var(--ink)' : 'color-mix(in oklab, var(--ink) 10%, transparent)',
        color: hover ? '#fff' : 'var(--ink)',
        cursor: 'pointer',
        display: 'grid',
        placeItems: 'center',
        padding: 0,
        transition: 'background-color 140ms ease, color 140ms ease',
      }}
    >
      <ChevronLeft size={12} />
    </button>
  );
}

function CollapsedRail({
  trips,
  activeTripId,
  stateFilter,
  onStateFilterChange,
  toggle,
}: {
  trips: TripRowData[];
  activeTripId: string | null;
  stateFilter: TripState | null;
  onStateFilterChange: (s: TripState) => void;
  toggle: () => void;
}) {
  const awaiting = trips.filter(t => t.state === 'AWAITING').length;
  const holds = trips.filter(t => t.state === 'HOLD').length;
  const settled = trips.filter(t => t.state === 'SETTLED').length;
  return (
    <div
      style={{
        borderRight: '1px solid var(--ink)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '12px 6px',
        gap: 14,
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={toggle}
        aria-label="Expand inbox rail"
        title="Expand inbox"
        style={{
          width: 32,
          height: 32,
          borderRadius: 6,
          border: 0,
          background: 'var(--surface-floating)',
          color: 'var(--midnight)',
          cursor: 'pointer',
          display: 'grid',
          placeItems: 'center',
          padding: 0,
          boxShadow: 'inset 0 0 0 1px var(--ink-soft)',
        }}
      >
        <ChevronRight size={16} />
      </button>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          alignItems: 'center',
          width: '100%',
          borderBottom: '1px solid var(--ink)',
          paddingBottom: 12,
        }}
      >
        <Count
          label="AW"
          value={awaiting}
          active={stateFilter === 'AWAITING'}
          hasFilter={stateFilter !== null}
          onClick={() => onStateFilterChange('AWAITING')}
        />
        <Count
          label="HO"
          value={holds}
          active={stateFilter === 'HOLD'}
          hasFilter={stateFilter !== null}
          onClick={() => onStateFilterChange('HOLD')}
        />
        <Count
          label="ST"
          value={settled}
          active={stateFilter === 'SETTLED'}
          hasFilter={stateFilter !== null}
          onClick={() => onStateFilterChange('SETTLED')}
        />
      </div>

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 6,
          width: '100%',
        }}
      >
        {trips.map(t => {
          const active = t.id === activeTripId;
          return (
            <Link
              key={t.id}
              href={`/dashboard/console?tripId=${t.id}`}
              title={t.who}
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                border: active ? '2px solid var(--vermillion)' : '1px solid var(--ink)',
                background: active ? 'var(--tint-vermillion-soft)' : '#fdfbf7',
                display: 'grid',
                placeItems: 'center',
                textDecoration: 'none',
                color: active ? 'var(--vermillion)' : 'var(--ink)',
                fontFamily: 'var(--font-mono-x)',
                fontSize: 9,
                fontWeight: 600,
                letterSpacing: '0.04em',
                flexShrink: 0,
              }}
            >
              {tripInitials(t.who)}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function tripInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function Count({
  label,
  value,
  active,
  hasFilter,
  onClick,
}: {
  label: string;
  value: number;
  active: boolean;
  hasFilter: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={`Filter by ${label}`}
      onClick={onClick}
      style={{
        fontFamily: 'var(--font-mono-x)',
        fontSize: 9,
        letterSpacing: '0.08em',
        color: active ? 'var(--vermillion)' : value > 0 ? 'var(--ink)' : 'var(--text-faint)',
        textAlign: 'center',
        lineHeight: 1.2,
        background: active ? 'var(--tint-vermillion-soft)' : 'transparent',
        border: 0,
        borderRadius: 4,
        padding: '3px 4px',
        cursor: 'pointer',
        width: '100%',
        opacity: hasFilter && !active ? 0.35 : 1,
        transition: 'opacity 120ms ease, background 120ms ease',
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 600 }}>{value}</div>
      <div>{label}</div>
    </button>
  );
}
