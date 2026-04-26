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

import { type ReactNode, useState } from 'react';

import Link from 'next/link';

import { Stage } from '@/components/stage';
import { useSendero } from '@/components/store';
import { SettleHoldButton } from '@/components/trips/settle-hold-button';
import { WorkflowLog } from '@/components/workflow-log';

import { ChannelHeader } from './channel-header';
import { asChannelKey, CHANNELS, type ChannelKey } from './channels';
import { type ComposerMode, ConsoleComposer } from './composer';
import { InboxRail } from './inbox-rail';
import type { TripRowData } from './trip-rail';

export type { ComposerMode };

export interface ConversationEntry {
  id: string;
  role: 'system' | 'op' | 'ai' | 'tool' | 'customer' | 'result';
  body?: string;
  /** When role === 'tool' or 'result'. */
  toolName?: string;
  toolArgs?: string;
  toolCost?: string;
  /** When role === 'customer' — which channel the message arrived on. */
  channel?: ChannelKey;
  /** Local-clock timestamp like "14:02". */
  t?: string;
  /** When role === 'result' — short table preview. */
  rows?: Array<Record<string, unknown>>;
}

interface MetaInboxProps {
  trips: TripRowData[];
  scopedTripId: string | null;
  /**
   * Server-rendered fallback conversation (used in scoped mode where
   * messages come from the inbox event log). Internal mode passes
   * `conversationSlot` instead, which streams from useChat through
   * AI Elements.
   */
  conversation: ConversationEntry[];
  /**
   * Pre-rendered conversation surface (AI Elements). When provided,
   * replaces the inline ConversationEntry render. MetaInboxLive uses
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
}

export function MetaInbox({
  trips,
  scopedTripId,
  conversation,
  conversationSlot,
  traveler,
  holdExpires,
  pendingBooking,
  composerMode,
  onComposerModeChange,
  onSubmit,
  disabled,
}: MetaInboxProps) {
  const [customerPanelOpen, setCustomerPanelOpen] = useState(false);
  const showWorkflow = useSendero(s => s.showWorkflow);

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
  const baseCols = 'auto 380px 1fr';
  const cols =
    baseCols + (isTrip && customerPanelOpen ? ' 300px' : '') + (showWorkflow ? ' 240px' : '');

  return (
    <div
      style={{
        position: 'relative',
        background: isTrip
          ? 'var(--surface-base)'
          : 'linear-gradient(135deg, rgba(245,237,224,0.55) 0%, rgba(239,228,210,0.55) 100%)',
        padding: '12px 14px',
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      {/* INTERNAL watermark — only when unscoped. */}
      {!isTrip && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            top: '52%',
            left: '50%',
            transform: 'translate(-50%,-50%) rotate(-12deg)',
            fontFamily: 'var(--font-display)',
            fontSize: 120,
            fontWeight: 500,
            color: 'rgba(31,42,68,0.05)',
            pointerEvents: 'none',
            userSelect: 'none',
            zIndex: 0,
            letterSpacing: '-0.02em',
            whiteSpace: 'nowrap',
          }}
        >
          INTERNAL · OPERATOR
        </div>
      )}

      <div
        style={{
          position: 'relative',
          zIndex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          flex: 1,
          minHeight: 0,
        }}
      >
        {isTrip ? (
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 8,
              alignItems: 'center',
            }}
          >
            {!customerPanelOpen ? (
              <button
                type="button"
                onClick={() => setCustomerPanelOpen(true)}
                className="t-mono"
                style={{
                  padding: '6px 12px',
                  background: 'var(--midnight)',
                  color: '#fdfbf7',
                  border: 0,
                  borderRadius: 5,
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                ◧ Show customer panel
              </button>
            ) : null}
            <Link
              href="/dashboard/console"
              className="sd-pill sd-pill-outline"
              style={{ padding: '6px 12px', fontSize: 11, textDecoration: 'none' }}
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
          </div>
        ) : null}

        <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 0, flex: 1, minHeight: 0 }}>
          {/* LEFT — collapsible inbox rail. Default-collapsed thin
              strip with awaiting/holds/settled counts; expands to the
              full TripRail with the trip list + filters. */}
          <InboxRail
            trips={trips}
            activeTripId={focused?.id ?? null}
            scopedTripId={scopedTripId}
            scopedChannel={isTrip ? channel : undefined}
          />

          {/* CENTER — conversation */}
          <div
            style={{
              padding: '0 16px',
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
              {conversationSlot ??
                (conversation.length === 0 ? (
                  <EmptyConversation isTrip={isTrip} />
                ) : (
                  conversation.map(entry => (
                    <ConversationRow
                      key={entry.id}
                      entry={entry}
                      isTrip={isTrip}
                      travelerInitials={traveler?.initials}
                    />
                  ))
                ))}
            </div>

            <ConsoleComposer
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
              style={{
                borderLeft: '1px solid var(--ink-soft)',
                paddingLeft: 18,
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
                overflow: 'auto',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span className="t-meta">Customer</span>
                <span style={{ flex: 1 }} />
                <button
                  type="button"
                  onClick={() => setCustomerPanelOpen(false)}
                  className="t-mono ink-60"
                  style={{
                    fontSize: 10,
                    cursor: 'pointer',
                    background: 'transparent',
                    border: 0,
                  }}
                >
                  hide ✕
                </button>
              </div>
              {focused ? <TripContextCards trip={focused} channel={channel} /> : null}
            </div>
          ) : null}

          {/* WORKFLOW — the SenderoApp WorkflowLog, gated by the global
              showWorkflow tweaks toggle. Same component the `/` shell
              uses, so meter ticks + workflow events render through one
              canonical view across the app. */}
          {showWorkflow ? (
            <div
              style={{
                paddingLeft: 12,
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

function ConversationRow({
  entry,
  isTrip,
  travelerInitials,
}: {
  entry: ConversationEntry;
  isTrip: boolean;
  travelerInitials?: string;
}) {
  const channel = entry.channel ? CHANNELS[entry.channel] : null;
  if (entry.role === 'system') {
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
          {entry.body}
        </div>
      </div>
    );
  }
  if (entry.role === 'op') {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <div style={{ maxWidth: '72%' }}>
          <div
            className="sd-card-flat"
            style={{
              padding: '10px 14px',
              background: 'var(--surface-floating)',
              boxShadow: 'inset 0 0 0 1px var(--hairline-color)',
              borderRadius: 10,
            }}
          >
            <div className="t-body" style={{ fontSize: 13, lineHeight: 1.5 }}>
              {entry.body}
            </div>
          </div>
          <div className="t-mono ink-60" style={{ fontSize: 10, marginTop: 4, textAlign: 'right' }}>
            {entry.t} · you {isTrip ? `· via ${channel?.name ?? 'web'}` : '(private)'}
          </div>
        </div>
      </div>
    );
  }
  if (entry.role === 'customer' && channel) {
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
            {entry.body}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
            {channel.icon(10)}
            <span className="t-mono" style={{ fontSize: 11, color: channel.accent }}>
              via {channel.name} · {entry.t}
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
  if (entry.role === 'ai') {
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
            {entry.body}
          </div>
          <div className="t-mono ink-60" style={{ fontSize: 10, marginTop: 4 }}>
            {entry.t} · sendero {isTrip ? `· sent to ${channel?.name ?? 'channel'}` : '(private)'}
          </div>
        </div>
      </div>
    );
  }
  if (entry.role === 'tool') {
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
          {entry.toolName}
        </span>
        {entry.toolArgs ? (
          <span className="t-mono ink-60" style={{ fontSize: 10 }}>
            {entry.toolArgs}
          </span>
        ) : null}
        {entry.toolCost ? (
          <span className="t-mono ink-60" style={{ fontSize: 10 }}>
            {entry.toolCost}
          </span>
        ) : null}
      </div>
    );
  }
  if (entry.role === 'result' && entry.rows) {
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
            {entry.toolName}
          </span>
          <span className="t-mono ink-60" style={{ fontSize: 10 }}>
            · {entry.rows.length} results
          </span>
        </div>
        {entry.rows.map((r, ri) => (
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
  return null;
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
            : 'Run a report, change policy, or investigate a trip. None of this reaches a customer.'}
        </div>
      </div>
    </div>
  );
}

function TripContextCards({
  trip,
  channel,
}: {
  trip: TripRowData;
  channel: ReturnType<typeof CHANNELS extends Record<string, infer V> ? () => V : never>;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div
        className="sd-card-flat"
        style={{ boxShadow: 'inset 0 0 0 1px var(--hairline-color)', padding: '12px 14px' }}
      >
        <div className="t-meta">Channel</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
          {channel.icon(16)}
          <span className="t-body" style={{ fontWeight: 600, fontSize: 13 }}>
            {channel.name}
          </span>
        </div>
        <div className="t-mono ink-60" style={{ fontSize: 11, marginTop: 4 }}>
          {channel.handle}
        </div>
      </div>
      <div
        className="sd-card-flat"
        style={{ boxShadow: 'inset 0 0 0 1px var(--hairline-color)', padding: '12px 14px' }}
      >
        <div className="t-meta">Trip</div>
        <div className="t-body" style={{ fontSize: 13, fontWeight: 500, marginTop: 6 }}>
          {trip.who}
        </div>
        <div className="t-mono ink-60" style={{ fontSize: 11, marginTop: 4 }}>
          {trip.id} · {trip.route}
        </div>
        <div style={{ marginTop: 8 }}>
          <span
            className={`sd-pill sd-pill-${trip.tone}`}
            style={{ fontSize: 9, padding: '2px 7px' }}
          >
            {trip.state}
          </span>
        </div>
      </div>
    </div>
  );
}
