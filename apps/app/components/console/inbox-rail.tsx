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

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useQueryState } from 'nuqs';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { TripRail, type TripRowData } from './trip-rail';
import type { CHANNELS } from './channels';

const STORAGE_KEY = 'sendero.console.inboxRail.expanded';

interface InboxRailProps {
  trips: TripRowData[];
  activeTripId: string | null;
  scopedTripId: string | null;
  scopedChannel?: ReturnType<typeof CHANNELS extends Record<string, infer V> ? () => V : never>;
}

export function InboxRail(props: InboxRailProps) {
  // Collapsed by default. Persist the operator's choice across page
  // reloads so they don't have to re-collapse every time.
  const [expanded, setExpanded] = useState(false);

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
      <ExpandedRail toggle={toggle}>
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
            <TripRail {...props} />
          </TabsContent>
          <TabsContent value="chats" className="mt-0 flex-1 min-h-0 overflow-auto">
            <ChatHistoryList />
          </TabsContent>
        </Tabs>
      </ExpandedRail>
    );
  }

  return <CollapsedRail trips={props.trips} toggle={toggle} />;
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
  const [activeCs, setActiveCs] = useQueryState('cs');

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
          padding: '14px 8px',
          fontSize: 10,
          color: 'var(--text-faint)',
          fontFamily: 'var(--font-mono)',
        }}
      >
        Loading…
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
            void setActiveCs(s.id);
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
              activeCs === s.id
                ? 'color-mix(in oklab, var(--ink) 8%, transparent)'
                : 'transparent',
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

function ExpandedRail({ toggle, children }: { toggle: () => void; children: ReactNode }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      style={{
        position: 'relative',
        width: EXPANDED_WIDTH,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      {children}
      <button
        type="button"
        aria-label="Collapse inbox rail"
        onClick={toggle}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          position: 'absolute',
          top: 88,
          right: 6,
          width: 26,
          height: 26,
          borderRadius: '50%',
          border: 0,
          background: hover ? 'var(--ink)' : 'color-mix(in oklab, var(--ink) 8%, transparent)',
          color: hover ? '#fff' : 'var(--text-faint)',
          cursor: 'pointer',
          display: 'grid',
          placeItems: 'center',
          padding: 0,
          transition: 'background-color 140ms ease, color 140ms ease',
        }}
      >
        <ChevronLeft size={14} />
      </button>
    </div>
  );
}

function CollapsedRail({ trips, toggle }: { trips: TripRowData[]; toggle: () => void }) {
  const awaiting = trips.filter(t => t.state === 'AWAITING').length;
  const holds = trips.filter(t => t.state === 'HOLD').length;
  const settled = trips.filter(t => t.state === 'SETTLED').length;
  return (
    <div
      style={{
        borderRight: '1px solid var(--ink-soft)',
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
        }}
      >
        <Count label="AW" value={awaiting} />
        <Count label="HO" value={holds} />
        <Count label="ST" value={settled} />
      </div>
    </div>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div
      title={`${label} · ${value}`}
      style={{
        fontFamily: 'var(--font-mono-x)',
        fontSize: 9,
        letterSpacing: '0.08em',
        color: value > 0 ? 'var(--vermillion)' : 'var(--text-faint)',
        textAlign: 'center',
        lineHeight: 1.2,
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 600 }}>{value}</div>
      <div>{label}</div>
    </div>
  );
}
