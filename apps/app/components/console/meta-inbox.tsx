'use client';

/**
 * MetaInbox — the canonical Console layout from
 * `/sendero/project/route-artboards.jsx::MetaInbox`.
 *
 * Two modes, one surface:
 *
 *   - Unscoped (no `?tripId=`) — operator ↔ Sendero AI. Sand background,
 *     "INTERNAL · OPERATOR" watermark, dark Sendero-AI header chip,
 *     terminal composer.  Nothing here goes to a customer.
 *
 *   - Scoped (`?tripId=…`) — operator ↔ traveler via the trip's
 *     channel (WhatsApp / Slack / SMS / etc).  Channel-tinted
 *     header, channel-aware customer bubbles, channel-tinted
 *     composer.  Replies route through the trip's primary channel.
 *
 * Three columns: trip rail · conversation · customer panel
 * (toggleable). Optional fourth column: nanopay terminal.
 *
 * Reads server-fetched data (trips, the focused conversation events)
 * passed in by the page-level RSC.  All client state stays here.
 */

import { type ReactNode, useCallback, useMemo, useRef, useState } from 'react';

import Link from 'next/link';

import { Stage } from '@/components/stage';
import { useSendero } from '@/components/store';
import { SettleHoldButton } from '@/components/trips/settle-hold-button';
import { WorkflowLog } from '@/components/workflow-log';
import type { UnifiedMessage } from '@/lib/unified-message';

import { ChannelHeader } from './channel-header';
import { asChannelKey, CHANNELS, type ChannelKey } from './channels';
import { type ComposerHandle, type ComposerMode, ConsoleComposer } from './composer';
import { ConsoleHero, TripHero } from './console-hero';
import { InboxRail } from './inbox-rail';
import type { TripRowData } from './trip-rail';

export type { ComposerMode };

/** Re-exported so MetaInboxLive can build optimistic rows in the same shape. */
export type { UnifiedMessage } from '@/lib/unified-message';

interface MetaInboxProps {
  trips: TripRowData[];
  scopedTripId: string | null;
  /**
   * Server-rendered fallback conversation (used in scoped mode where
   * messages come from the inbox event log). Internal mode passes
   * `conversationSlot` instead, which streams from useChat through
   * AI Elements.
   */
  conversation: UnifiedMessage[];
  /**
   * Pre-rendered conversation surface (AI Elements). When provided,
   * replaces the inline UnifiedMessage render. MetaInboxLive uses
   * this to drive internal-mode chat through the same Conversation /
   * Message / Tool / Reasoning stack the working `/dashboard/agent-chat`
   * test bench uses.
   */
  conversationSlot?: ReactNode;
  /** Optional traveler info — drives the scoped header. */
  traveler?: {
    name: string;
    initials: string;
  } | null;
  /** Hold-expires countdown ("59:48") when status === 'awaiting hold'. */
  holdExpires?: string | null;
  /**
   * Earliest pending booking on the scoped trip. When set, the
   * "Approve hold" header slot renders the operator settle CTA wired
   * to that booking. Null on trips with nothing to settle, undefined
   * in unscoped console mode.
   */
  pendingBooking?: { id: string; totalUsd: string } | null;
  /** Workspace-mode header KPIs. Ignored in scoped (trip) mode. */
  kpis?: {
    settled30dCount: number;
    settled30dFare: string | null;
    avgResponseLabel: string | null;
  };
  /**
   * Phase B — when true, suppresses the inline KPI grid in
   * ConsoleHero (workspace mode). The @kpis parallel-routes slot
   * renders the KPI strip above the inbox in the layout.
   */
  hideKpiStrip?: boolean;
  /**
   * Active composer mode. In unscoped (no tripId) mode this is forced
   * to 'internal'. In scoped mode the operator can flip via the footer
   * toggle. MetaInboxLive owns the state so it can route the next
   * submission to the right backend.
   */
  composerMode?: ComposerMode;
  onComposerModeChange?: (mode: ComposerMode) => void;
  /** Composer submit handler. When omitted, the composer is read-only. */
  onSubmit?: (text: string) => void | Promise<void>;
  /** When true, the composer is disabled (turn in flight). */
  disabled?: boolean;
  /**
   * Optional render slot rendered above the composer (channel mode).
   * Used by MetaInboxLive to mount the rich-card inject affordance
   * — Phase G.4. Hidden in unscoped (no tripId) state.
   */
  composerExtras?: React.ReactNode;
  /**
   * Phase B — when false, the InboxRail column is omitted from the
   * grid. The console route renders the rail as a sibling parallel-
   * routes slot (`@threads`) so it streams in independently.
   * Defaults to true to preserve backward-compatible mounting from
   * any other surface still composing MetaInbox directly.
   */
  embedRail?: boolean;
}

export function MetaInbox({
  trips,
  scopedTripId,
  conversation,
  conversationSlot,
  traveler,
  holdExpires,
  pendingBooking,
  kpis,
  hideKpiStrip = false,
  composerMode,
  onComposerModeChange,
  onSubmit,
  disabled,
  composerExtras,
  embedRail = true,
}: MetaInboxProps) {
  const [customerPanelOpen, setCustomerPanelOpen] = useState(false);
  const showWorkflow = useSendero(s => s.showWorkflow);
  const composerRef = useRef<ComposerHandle | null>(null);
  const onCommand = useCallback((cmd: string) => {
    composerRef.current?.seed(cmd);
  }, []);

  const focused = scopedTripId
    ? (trips.find(t => t.id === scopedTripId) ?? null)
    : (trips[0] ?? null);
  const isTrip = Boolean(scopedTripId);
  const tripChannelKey: ChannelKey = isTrip ? asChannelKey(focused?.channel) : 'internal';
  const tripChannel = CHANNELS[tripChannelKey];

  // Effective composer mode. Unscoped is locked to 'internal'.
  const effectiveMode: ComposerMode = isTrip ? (composerMode ?? 'channel') : 'internal';
  // Header reflects the trip's true channel regardless of mode; only
  // the composer surface flips between PRIVATE (ink) and the channel
  // tint when the operator opts into a private aside.
  const channelKey = tripChannelKey;
  const channel = tripChannel;

  // Layout: inbox rail (collapsible) · chat · stage · (customer panel
  // when scoped+open) · workflow log (when showWorkflow).
  //
  // Inbox rail uses `auto` so it claims its natural width — 44px when
  // collapsed (the default), ~280px when the operator expands it.
  // Stage is always present so the operator sees booking artifacts
  // inline as the agent runs tools. WorkflowLog is the right-most
  // terminal toggled by the FooterRail tweaks switch (`showWorkflow`).
  // Narrower conversation column so the stage (offers / artifacts / etc) gets
  // more room. Operators can pop the conversation into a full-screen dialog
  // via the expand button on the SENDERO AI header.
  //
  // When `embedRail` is false (the console route's parallel-routes
  // setup), the rail column is dropped — the @threads slot renders
  // it as a sibling. Responsive overrides in globals.css still target
  // `:first-child` of `.meta-inbox-grid`; with no rail that's the
  // conversation column, which is exactly what we want hidden at
  // narrow widths anyway (the conversation column owns `grid-column:
  // 1 / -1` at ≤900px, so the rule still resolves correctly).
  const baseCols = embedRail ? 'auto 380px 1fr' : '380px 1fr';
  const cols = baseCols + (showWorkflow ? ' 240px' : '');

  return (
    <div
      style={{
        position: 'relative',
        background: isTrip
          ? 'var(--surface-base)'
          : 'linear-gradient(135deg, rgba(245,237,224,0.55) 0%, rgba(239,228,210,0.55) 100%)',
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          minHeight: 0,
        }}
      >
        {isTrip ? (
          <TripHero
            traveler={focused?.who ?? 'Traveler'}
            route={focused?.route ?? ''}
            tripId={scopedTripId ?? focused?.id ?? ''}
            channel={channel}
            hold={holdExpires ?? null}
            onCommand={onCommand}
            toolbarSlot={
              <>
                <button
                  type="button"
                  onClick={() => setCustomerPanelOpen(v => !v)}
                  className="t-mono"
                  style={{
                    padding: '5px 10px',
                    background: customerPanelOpen ? 'transparent' : 'var(--midnight)',
                    color: customerPanelOpen ? 'var(--midnight)' : '#fdfbf7',
                    border: customerPanelOpen ? '1px solid var(--hairline-color)' : 0,
                    borderRadius: 5,
                    fontSize: 10.5,
                    cursor: 'pointer',
                  }}
                >
                  {customerPanelOpen ? '◨ Close panel' : '◧ Show customer panel'}
                </button>
                <Link
                  href="/dashboard/console"
                  className="sd-pill sd-pill-outline"
                  style={{ padding: '5px 10px', fontSize: 10.5, textDecoration: 'none' }}
                >
                  ↑ Pop to console
                </Link>
                {pendingBooking && scopedTripId ? (
                  <SettleHoldButton
                    tripId={scopedTripId}
                    bookingId={pendingBooking.id}
                    amountUsd={pendingBooking.totalUsd}
                    variant="inbox"
                  />
                ) : null}
              </>
            }
          />
        ) : (
          <ConsoleHero
            trips={trips}
            settled30dCount={kpis?.settled30dCount ?? null}
            settled30dFare={kpis?.settled30dFare ?? null}
            avgResponseLabel={kpis?.avgResponseLabel ?? null}
            onCommand={onCommand}
            hideKpiStrip={hideKpiStrip}
          />
        )}

        <div
          className="meta-inbox-grid"
          data-embed-rail={embedRail ? 'true' : 'false'}
          style={{
            display: 'grid',
            gridTemplateColumns: `var(--meta-inbox-cols, ${cols})`,
            gap: 0,
            flex: 1,
            minHeight: 0,
          }}
        >
          {/* LEFT — collapsible inbox rail. Default-collapsed thin
              strip with awaiting/holds/settled counts; expands to the
              full TripRail with the trip list + filters.
              Phase B: when the console route owns the rail via the
              @threads parallel-routes slot, embedRail is false and
              this column is omitted. The grid then starts at the
              conversation column. */}
          {embedRail ? (
            <InboxRail
              trips={trips}
              activeTripId={focused?.id ?? null}
              scopedTripId={scopedTripId}
              scopedChannel={isTrip ? channel : undefined}
            />
          ) : null}

          {/* CENTER — conversation */}
          <div
            className="meta-inbox-conversation"
            style={{
              padding: '8px 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              minHeight: 0,
              overflow: 'hidden',
            }}
          >
            <ChannelHeader
              channel={channelKey}
              traveler={isTrip ? focused?.who : undefined}
              tripId={isTrip ? (scopedTripId ?? undefined) : undefined}
              hold={isTrip ? holdExpires : null}
            />

            <div
              style={{
                flex: 1,
                overflow: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
                paddingRight: 4,
              }}
            >
              {conversationSlot ?? (
                <UnifiedConversation
                  messages={conversation}
                  isTrip={isTrip}
                  travelerInitials={traveler?.initials}
                />
              )}
            </div>

            {composerExtras && isTrip && effectiveMode === 'channel' ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 4,
                }}
              >
                {composerExtras}
              </div>
            ) : null}

            <ConsoleComposer
              ref={composerRef}
              mode={effectiveMode}
              tripChannel={tripChannelKey}
              onModeChange={onComposerModeChange ?? (() => {})}
              suggestions={
                effectiveMode === 'internal'
                  ? isTrip
                    ? [
                        `/policy ${focused?.who?.split(' ')[0] ?? ''}`,
                        '/spend trip',
                        `@${scopedTripId} status`,
                      ]
                    : ['/spend last 30d', '/demo trip', '@trp-3392 status']
                  : ['Hold confirmed', 'Need traveler approval', 'Send invoice']
              }
              disabled={disabled || !onSubmit}
              onSubmit={onSubmit ?? (() => {})}
            />
          </div>

          {/* STAGE — booking artifacts (offer cards / hold card /
              settle panel / hotels). Same component the `/` shell uses;
              MetaInboxLive's useChatStoreSync feeds it the data so
              flights/hotels/treasury flows render here as the agent
              runs tools. Borderless + transparent so it floats over
              the parchment field per DESIGN.md §9. */}
          <div
            className="meta-inbox-stage"
            style={{
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <Stage />
          </div>

          {/* CUSTOMER — only when scoped + open. Hidden by default; the
              footer chip can re-open it for trip context lookups. */}
          {isTrip && customerPanelOpen ? (
            <div
              className="meta-inbox-customer"
              style={{
                borderLeft: '1px solid var(--ink)',
                width: 220,
                flexShrink: 0,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              }}
            >
              {/* Panel header */}
              <div
                style={{
                  padding: '10px 16px',
                  borderBottom: '1px solid var(--ink)',
                  flexShrink: 0,
                }}
              >
                <span className="t-meta">Customer</span>
              </div>
              {/* Panel body */}
              <div style={{ flex: 1, overflow: 'auto', padding: '0 16px' }}>
                {focused ? <TripContextCards trip={focused} channel={channel} /> : null}
              </div>
            </div>
          ) : null}

          {/* WORKFLOW — the SenderoApp WorkflowLog, gated by the global
              showWorkflow tweaks toggle. Same component the `/` shell
              uses, so meter ticks + workflow events render through one
              canonical view across the app. */}
          {showWorkflow ? (
            <div
              className="meta-inbox-workflow"
              style={{
                paddingLeft: 12,
                paddingRight: 8,
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              }}
            >
              <WorkflowLog />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ─── atoms ────────────────────────────────────────────────────────

const FILTER_OPTIONS: ReadonlyArray<{ key: 'all' | ChannelKey; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'internal', label: 'Private' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'slack', label: 'Slack' },
  { key: 'web', label: 'Web' },
  { key: 'email', label: 'Email' },
  { key: 'sms', label: 'SMS' },
];

function UnifiedConversation({
  messages,
  isTrip,
  travelerInitials,
}: {
  messages: UnifiedMessage[];
  isTrip: boolean;
  travelerInitials?: string;
}) {
  const [filter, setFilter] = useState<'all' | ChannelKey>('all');

  // Only show the chip rail when there's enough variety to filter on.
  // Single-channel threads don't benefit from chips and the rail steals
  // vertical space from the conversation.
  const channelsPresent = useMemo(() => {
    const set = new Set<ChannelKey>();
    for (const m of messages) set.add(m.channel);
    return set;
  }, [messages]);
  const showChips = channelsPresent.size > 1;

  const visible = useMemo(
    () => (filter === 'all' ? messages : messages.filter(m => m.channel === filter)),
    [filter, messages]
  );

  if (messages.length === 0) {
    return <EmptyConversation isTrip={isTrip} />;
  }

  return (
    <>
      {showChips ? (
        <div
          style={{
            display: 'flex',
            gap: 6,
            flexWrap: 'wrap',
            paddingBottom: 4,
            borderBottom: '1px solid var(--hairline-color-soft)',
            marginBottom: 4,
          }}
        >
          {FILTER_OPTIONS.filter(o => o.key === 'all' || channelsPresent.has(o.key)).map(o => {
            const active = filter === o.key;
            return (
              <button
                key={o.key}
                type="button"
                onClick={() => setFilter(o.key)}
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9.5,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  padding: '3px 9px',
                  border: '1px solid var(--ink)',
                  borderRadius: 12,
                  background: active ? 'var(--ink)' : 'transparent',
                  color: active ? '#fdfbf7' : 'var(--ink)',
                  cursor: 'pointer',
                }}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      ) : null}
      {visible.length === 0 ? (
        <div
          style={{
            padding: '16px 12px',
            color: 'var(--text-dim)',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            textAlign: 'center',
          }}
        >
          {`No messages on ${filter}.`}
        </div>
      ) : (
        visible.map(m => (
          <ConversationRow
            key={m.id}
            message={m}
            isTrip={isTrip}
            travelerInitials={travelerInitials}
          />
        ))
      )}
    </>
  );
}

function ConversationRow({
  message,
  isTrip,
  travelerInitials,
}: {
  message: UnifiedMessage;
  isTrip: boolean;
  travelerInitials?: string;
}) {
  const channel = CHANNELS[message.channel];
  const t = message.at ? new Date(message.at).toTimeString().slice(0, 5) : '';

  if (message.kind === 'system_note') {
    return (
      <div
        className="sd-card-flat"
        style={{
          padding: '12px 16px',
          background: 'var(--midnight)',
          color: '#fdfbf7',
          borderRadius: 8,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
        }}
      >
        <span
          style={{
            width: 22,
            height: 22,
            borderRadius: 11,
            background: 'rgba(232,185,142,0.15)',
            display: 'grid',
            placeItems: 'center',
            flexShrink: 0,
            marginTop: 1,
          }}
        >
          🛡
        </span>
        <div className="t-body" style={{ fontSize: 12.5 }}>
          {message.body}
        </div>
      </div>
    );
  }

  if (message.kind === 'tool_call') {
    return (
      <div
        style={{
          alignSelf: 'center',
          padding: '4px 12px',
          borderRadius: 999,
          background: 'var(--tint-midnight-soft)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span
          className="t-meta"
          style={{ color: isTrip ? 'var(--vermillion)' : 'var(--midnight)', fontSize: 9 }}
        >
          {isTrip ? 'CUSTOMER TOOL' : 'INTERNAL TOOL'}
        </span>
        <span
          className="t-mono"
          style={{ fontSize: 11, color: 'var(--vermillion)', fontWeight: 500 }}
        >
          {message.toolName}
        </span>
        {message.toolArgs ? (
          <span className="t-mono ink-60" style={{ fontSize: 10 }}>
            {message.toolArgs}
          </span>
        ) : null}
        {message.toolCost ? (
          <span className="t-mono ink-60" style={{ fontSize: 10 }}>
            {message.toolCost}
          </span>
        ) : null}
      </div>
    );
  }

  if (message.kind === 'tool_result' && message.rows) {
    return (
      <div
        className="sd-card-flat"
        style={{
          marginLeft: 34,
          padding: '14px 16px',
          boxShadow: 'inset 0 0 0 1px var(--hairline-color)',
          background: 'var(--surface-floating)',
          maxWidth: '86%',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span
            className="t-mono"
            style={{ fontSize: 11, color: 'var(--vermillion)', fontWeight: 600 }}
          >
            {message.toolName}
          </span>
          <span className="t-mono ink-60" style={{ fontSize: 10 }}>
            · {message.rows.length} results
          </span>
        </div>
        {message.rows.map((r, ri) => (
          <div
            key={ri}
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(80px, 1fr))',
              gap: 12,
              padding: '6px 0',
              borderTop: ri > 0 ? '1px solid var(--ink-soft)' : 'none',
              alignItems: 'baseline',
            }}
          >
            {Object.entries(r).map(([k, v]) => (
              <span
                key={k}
                className="t-mono ink-60"
                style={{
                  fontSize: 11,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={`${k}: ${String(v)}`}
              >
                {String(v)}
              </span>
            ))}
          </div>
        ))}
      </div>
    );
  }

  // ─── kind: 'message' ─────────────────────────────────────────────
  // Three render lanes from the (direction, author.kind) tuple:
  //
  //   inbound  · traveler → channel-tinted left-or-right bubble + traveler avatar
  //   outbound · operator → ink-border right bubble with channel watermark
  //   outbound · agent    → vermillion S avatar + channel watermark
  //   internal · operator → muted right bubble, "(private)" tag
  //   internal · agent    → vermillion S avatar, "(private)" tag

  if (message.direction === 'inbound' && message.author.kind === 'traveler') {
    return (
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <div
          style={{
            maxWidth: '56ch',
            background: channel.tint,
            boxShadow: 'var(--shadow-sm)',
            padding: '10px 14px',
            borderRadius: 14,
          }}
        >
          <div className="t-body" style={{ fontSize: 14 }}>
            {message.body}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
            {channel.icon(10)}
            <span className="t-mono" style={{ fontSize: 11, color: channel.accent }}>
              via {channel.name} · {t}
            </span>
          </div>
        </div>
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: 15,
            background: 'var(--midnight)',
            color: '#fdfbf7',
            display: 'grid',
            placeItems: 'center',
            fontSize: 12,
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          {travelerInitials ?? 'TR'}
        </div>
      </div>
    );
  }

  if (message.author.kind === 'agent') {
    const isPrivate = message.direction === 'internal';
    return (
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <span
          style={{
            width: 24,
            height: 24,
            borderRadius: 12,
            background: 'var(--vermillion)',
            color: '#fdfbf7',
            display: 'grid',
            placeItems: 'center',
            fontSize: 11,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          S
        </span>
        <div style={{ maxWidth: '72%' }}>
          <div className="t-body" style={{ fontSize: 13, lineHeight: 1.55 }}>
            {message.body}
          </div>
          <div
            className="t-mono ink-60"
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, marginTop: 4 }}
          >
            <span>{t}</span>
            <span>·</span>
            <span>sendero</span>
            {isPrivate ? (
              <span style={{ color: 'var(--midnight)' }}>(private)</span>
            ) : (
              <>
                <span>·</span>
                {channel.icon(10)}
                <span style={{ color: channel.accent }}>sent to {channel.name}</span>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // operator outbound (channel) OR internal — right-aligned bubble.
  const isPrivate = message.direction === 'internal';
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
      <div style={{ maxWidth: '72%' }}>
        <div
          className="sd-card-flat"
          style={{
            padding: '10px 14px',
            background: 'var(--surface-floating)',
            boxShadow: 'inset 0 0 0 1px var(--ink)',
            borderRadius: 10,
          }}
        >
          <div className="t-body" style={{ fontSize: 13, lineHeight: 1.5 }}>
            {message.body}
          </div>
        </div>
        <div
          className="t-mono ink-60"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 6,
            fontSize: 10,
            marginTop: 4,
          }}
        >
          <span>{t}</span>
          <span>·</span>
          <span>{message.author.displayName ?? 'you'}</span>
          {isPrivate ? (
            <span style={{ color: 'var(--midnight)' }}>(private)</span>
          ) : (
            <>
              <span>·</span>
              {channel.icon(10)}
              <span style={{ color: channel.accent }}>via {channel.name}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyConversation({ isTrip }: { isTrip: boolean }) {
  return (
    <div
      style={{
        flex: 1,
        display: 'grid',
        placeItems: 'center',
        textAlign: 'center',
        color: 'rgba(31,42,68,0.55)',
        padding: 24,
      }}
    >
      <div>
        <div className="t-h2" style={{ fontSize: 22, marginBottom: 8 }}>
          {isTrip ? 'No messages yet' : 'Ask Sendero anything'}
        </div>
        <div className="t-body ink-70" style={{ fontSize: 13, maxWidth: '42ch', margin: '0 auto' }}>
          {isTrip
            ? "Once the traveler replies on their channel, you'll see it here. Compose a draft below to start."
            : 'Run a report, change policy, or investigate a trip. None of this reaches a customer. Change channels to directly message your users or let Sendero AI handle it automatically. Use Sendero privately to give better customer support to make trips delightful.'}
        </div>
      </div>
    </div>
  );
}

function customerInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function TripContextCards({
  trip,
  channel,
}: {
  trip: TripRowData;
  channel: ReturnType<typeof CHANNELS extends Record<string, infer V> ? () => V : never>;
}) {
  const initials = customerInitials(trip.who || 'Traveler');
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Traveler profile */}
      <div
        style={{
          padding: '20px 0 18px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 10,
          textAlign: 'center',
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            border: '1.5px solid var(--ink)',
            background: '#fdfbf7',
            display: 'grid',
            placeItems: 'center',
            fontFamily: 'var(--font-mono-x)',
            fontSize: 15,
            fontWeight: 700,
            color: 'var(--ink)',
            letterSpacing: '0.04em',
            flexShrink: 0,
          }}
        >
          {initials}
        </div>
        <div>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 20,
              color: 'var(--ink)',
              lineHeight: 1.1,
            }}
          >
            {trip.who || 'Traveler'}
          </div>
          {trip.route ? (
            <div className="t-mono ink-60" style={{ fontSize: 10, marginTop: 3 }}>
              {trip.route}
            </div>
          ) : null}
          <div style={{ marginTop: 8, display: 'flex', justifyContent: 'center' }}>
            <span
              className={`sd-pill sd-pill-${trip.tone}`}
              style={{ fontSize: 8, padding: '2px 7px' }}
            >
              {trip.state}
            </span>
          </div>
        </div>
      </div>

      {/* Trip ID row */}
      <div
        style={{
          borderTop: '1px solid var(--hairline-color-soft, rgba(31,42,68,0.08))',
          padding: '10px 0',
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        <span className="t-meta">Trip</span>
        <span
          className="t-mono"
          style={{ fontSize: 10, color: 'var(--midnight)', wordBreak: 'break-all' }}
        >
          {trip.id}
        </span>
      </div>

      {/* Channel row */}
      <div
        style={{
          borderTop: '1px solid var(--hairline-color-soft, rgba(31,42,68,0.08))',
          padding: '10px 0',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        <span className="t-meta">Channel</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          {channel.icon(13)}
          <span className="t-body" style={{ fontWeight: 600, fontSize: 12 }}>
            {channel.name}
          </span>
        </div>
        <div className="t-mono ink-60" style={{ fontSize: 10 }}>
          {channel.handle}
        </div>
      </div>
    </div>
  );
}
