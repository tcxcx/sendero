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

import { useState } from 'react';
import Link from 'next/link';

import { asChannelKey, CHANNELS, type ChannelKey } from './channels';
import { ChannelHeader } from './channel-header';
import { ConsoleComposer } from './composer';
import { Crumb } from './crumb';
import { TripRail, type TripRowData } from './trip-rail';
import { SettleHoldButton } from '@/components/trips/settle-hold-button';

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

/** Server-confirmed MeterEvent row, streamed from `/api/meter/stream`. */
export interface LiveMeterEvent {
  id: string;
  toolName: string;
  toolNames?: string[];
  tripId?: string | null;
  priceMicroUsdc: string;
  status: 'paid' | 'free' | 'rejected' | 'sandbox';
  at: string;
}

interface MetaInboxProps {
  trips: TripRowData[];
  scopedTripId: string | null;
  conversation: ConversationEntry[];
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
   * Real, server-confirmed MeterEvents for this tenant (and the
   * focused trip when scoped). Populated by an SSE subscription in
   * MetaInboxLive; drives the running total + ledger of the
   * NanopayWorkflowsPanel. Empty until the first turn finishes.
   */
  meterEvents?: LiveMeterEvent[];
  /** Composer submit handler. When omitted, the composer is read-only. */
  onSubmit?: (text: string) => void | Promise<void>;
  /** When true, the composer is disabled (turn in flight). */
  disabled?: boolean;
}

export function MetaInbox({
  trips,
  scopedTripId,
  conversation,
  traveler,
  holdExpires,
  pendingBooking,
  meterEvents,
  onSubmit,
  disabled,
}: MetaInboxProps) {
  const [customerPanelOpen, setCustomerPanelOpen] = useState(true);
  const [nanopayOpen, setNanopayOpen] = useState(false);

  const focused = scopedTripId
    ? (trips.find(t => t.id === scopedTripId) ?? null)
    : (trips[0] ?? null);
  const isTrip = Boolean(scopedTripId);
  const channelKey: ChannelKey = isTrip ? asChannelKey(focused?.channel) : 'internal';
  const channel = CHANNELS[channelKey];

  // Column layout per mode:
  //   Unscoped:  rail · convo · NanopayPanel (always visible).
  //   Scoped:    rail · convo · Customer (toggleable) · NanopayPanel
  //              (toggleable via the footer switch). When both are
  //              open the panel sits as a 4th column instead of an
  //              inline footer expansion — that's the "trip-cost"
  //              terminal the design's NanopaymentPanel describes.
  const sidePanelOpen = isTrip ? customerPanelOpen : true;
  const baseCols = isTrip ? '260px 1fr' : '300px 1fr';
  const cols =
    baseCols +
    (sidePanelOpen ? (isTrip ? ' 300px' : ' 340px') : '') +
    (isTrip && nanopayOpen ? ' 320px' : '');

  return (
    <div
      style={{
        position: 'relative',
        background: isTrip
          ? 'var(--surface-base)'
          : 'linear-gradient(135deg, rgba(245,237,224,0.55) 0%, rgba(239,228,210,0.55) 100%)',
        padding: '24px 28px',
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
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
          gap: 18,
          flex: 1,
          minHeight: 0,
        }}
      >
        <Crumb
          trail={
            isTrip ? ['Workspace', 'Trip inbox', scopedTripId ?? ''] : ['Workspace', 'Console']
          }
        />

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            gap: 24,
          }}
        >
          <div>
            {isTrip && focused ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span className="t-meta">
                    {focused.who} · {focused.route} · {scopedTripId}
                  </span>
                  <span
                    className="sd-pill"
                    style={{
                      background: channel.tint,
                      color: channel.accent,
                      fontSize: 9,
                      fontWeight: 700,
                      padding: '3px 8px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    {channel.icon(10)} {channel.name.toUpperCase()}
                  </span>
                </div>
                <h1 className="t-h1" style={{ marginTop: 6 }}>
                  Trip inbox
                </h1>
                <div className="t-body-lg ink-70" style={{ marginTop: 6, maxWidth: '58ch' }}>
                  You're talking to <strong>{focused.who.split(' ')[0]}</strong> through{' '}
                  {channel.name}. Anything you send here goes to their phone.
                </div>
              </>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span className="t-meta">
                    Today · {trips.length} trips in flight ·{' '}
                    {trips.filter(t => t.state === 'AWAITING').length} awaiting
                  </span>
                  <span
                    className="sd-pill"
                    style={{
                      background: 'rgba(31,42,68,0.08)',
                      color: 'var(--midnight)',
                      fontSize: 9,
                      fontWeight: 700,
                      padding: '3px 8px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                    }}
                  >
                    🛡 PRIVATE · SENDERO AI
                  </span>
                </div>
                <h1 className="t-h1" style={{ marginTop: 6 }}>
                  Console
                </h1>
                <div className="t-body-lg ink-70" style={{ marginTop: 6, maxWidth: '62ch' }}>
                  Your private workspace with Sendero. Investigate trips, change policy, run reports
                  — none of this reaches a customer.
                </div>
              </>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'center' }}>
            {isTrip ? (
              <Link
                href="/dashboard/console"
                className="sd-pill sd-pill-outline"
                style={{ padding: '6px 12px', fontSize: 11, textDecoration: 'none' }}
              >
                ↑ Pop to console
              </Link>
            ) : null}
            <button
              type="button"
              className="sd-pill sd-pill-outline"
              style={{ padding: '6px 12px', fontSize: 11, border: 0 }}
            >
              <span className="t-mono" style={{ fontSize: 11 }}>
                ⌘K
              </span>
            </button>
            {isTrip && pendingBooking && scopedTripId ? (
              <SettleHoldButton
                tripId={scopedTripId}
                bookingId={pendingBooking.id}
                amountUsd={pendingBooking.totalUsd}
                variant="inbox"
              />
            ) : (
              <button
                type="button"
                style={{
                  padding: '6px 14px',
                  background: 'var(--vermillion)',
                  color: '#fdfbf7',
                  border: 0,
                  borderRadius: 8,
                  fontSize: 11,
                  fontWeight: 600,
                  fontFamily: 'var(--font-sans)',
                  cursor: 'pointer',
                }}
              >
                {isTrip ? 'No hold pending' : 'Run a report'}
              </button>
            )}
          </div>
        </div>

        {/* V2 hero band — KPIs + quick commands. Only in unscoped console
            mode; scoped trip inbox keeps the title row and goes straight
            to the columns. */}
        {!isTrip ? <ConsoleHeroBand trips={trips} /> : null}

        <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 0, flex: 1, minHeight: 0 }}>
          {/* LEFT — trip rail */}
          <TripRail
            trips={trips}
            activeTripId={focused?.id ?? null}
            scopedTripId={scopedTripId}
            scopedChannel={isTrip ? channel : undefined}
          />

          {/* CENTER — conversation */}
          <div
            style={{
              padding: '0 24px',
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
              {conversation.length === 0 ? (
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
              )}
            </div>

            <ConsoleComposer
              channel={channelKey}
              suggestions={
                isTrip
                  ? ['Hold confirmed', 'Need traveler approval', 'Send invoice']
                  : ['/spend last 30d', '/policy mei', '@trp-3392 status']
              }
              disabled={disabled || !onSubmit}
              onSubmit={onSubmit ?? (() => {})}
            />
          </div>

          {/* RIGHT — customer panel (scoped) or nanopay/workflows feed
              (unscoped). In V2 the unscoped 3rd column is the live
              ledger; KPIs moved to the hero band above. */}
          {sidePanelOpen ? (
            isTrip ? (
              <div
                style={{
                  borderLeft: '1px solid var(--hairline-color)',
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
            ) : (
              <NanopayWorkflowsPanel
                conversation={conversation}
                meterEvents={meterEvents}
                scope="session"
              />
            )
          ) : null}

          {/* 4th column — trip-scoped Nanopay panel. Footer switch
              opens it; while closed the trip view stays at 3 columns
              like before. */}
          {isTrip && nanopayOpen ? (
            <NanopayWorkflowsPanel
              conversation={conversation}
              meterEvents={meterEvents}
              scope="trip"
              tripId={scopedTripId}
              channelAccent={channel.accent}
            />
          ) : null}
        </div>

        {/* Footer — status row plus the nanopay terminal panel that
            toggles open via the switch on the right.  Both pieces
            share the same footer container so the terminal expands
            in place rather than reflowing the layout. */}
        <div
          style={{
            borderTop: '1px solid var(--hairline-color)',
            background: 'var(--surface-floating)',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              padding: '10px 18px',
              display: 'flex',
              alignItems: 'center',
              gap: 14,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                background: 'var(--accent-green)',
                boxShadow: '0 0 5px var(--accent-green)',
              }}
            />
            <span className="t-mono ink-60" style={{ fontSize: 10.5 }}>
              live · {isTrip ? scopedTripId : 'all trips'}
            </span>
            <span className="ink-50">·</span>
            <span className="t-mono ink-60" style={{ fontSize: 10.5 }}>
              x402 settlement:{' '}
              <span className="t-num-md" style={{ color: 'var(--midnight)', fontSize: 11 }}>
                $2.39
              </span>{' '}
              running
            </span>
            <span style={{ flex: 1 }} />
            {isTrip && !customerPanelOpen ? (
              <button
                type="button"
                onClick={() => setCustomerPanelOpen(true)}
                className="t-mono"
                style={{
                  padding: '5px 12px',
                  background: 'var(--midnight)',
                  color: '#fdfbf7',
                  border: 0,
                  borderRadius: 5,
                  fontSize: 10.5,
                  cursor: 'pointer',
                }}
              >
                ◧ Show customer panel
              </button>
            ) : null}
            {/* In unscoped mode the nanopay/workflows feed lives in the
                3rd column permanently; the footer terminal toggle only
                makes sense when zoomed into a single trip. */}
            {isTrip ? (
              <NanopaySwitch open={nanopayOpen} onToggle={() => setNanopayOpen(o => !o)} />
            ) : null}
          </div>
          {/* Inline footer terminal retired — the trip-scoped Nanopay
              panel now mounts as a real 4th column above so the
              ledger sits next to the conversation rather than
              squeezing the chat vertically. */}
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
              borderTop: ri > 0 ? '1px solid var(--hairline-color-soft)' : 'none',
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

// V2 hero band — KPIs + quick commands span the full width above the
// 3-col body. Replaces the old V1 right-rail "Workspace summary" card
// stack so the conversation can use the freed column for live nanopay
// + workflow signal.
const CONSOLE_KPIS = [
  { label: 'Today', big: '24', sub: 'trips in flight · 4 awaiting' },
  { label: 'Settled 30d', big: '312', sub: '$74,820 total fare' },
  { label: 'Avg response', big: '11s', sub: 'agent latency' },
] as const;

const QUICK_COMMANDS = [
  { k: '/spend', hint: '<period>' },
  { k: '/policy', hint: '<name|dept>' },
  { k: '/trip', hint: '<id>' },
  { k: '/handoff', hint: '@user' },
  { k: '/report', hint: '<scope>' },
] as const;

function ConsoleHeroBand({ trips }: { trips: TripRowData[] }) {
  const liveKpis: { label: string; big: string; sub: string }[] = [
    {
      label: 'Today',
      big: String(trips.length),
      sub: `${trips.filter(t => t.state === 'AWAITING').length} awaiting · live`,
    },
    CONSOLE_KPIS[1],
    CONSOLE_KPIS[2],
  ];
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto auto auto 1fr',
        gap: 14,
        padding: '14px 18px',
        background: 'linear-gradient(180deg, rgba(199,89,77,0.05) 0%, transparent 100%)',
        borderTop: '1px solid var(--hairline-color)',
        borderBottom: '1px solid var(--hairline-color)',
        borderRadius: 10,
        alignItems: 'stretch',
      }}
    >
      {liveKpis.map((k, i) => (
        <div
          key={k.label}
          style={{
            padding: '0 18px',
            borderRight: i < 2 ? '1px solid var(--hairline-color)' : 'none',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
          }}
        >
          <div className="t-meta" style={{ fontSize: 10 }}>
            {k.label}
          </div>
          <div className="t-num-lg" style={{ fontSize: 30, marginTop: 4, lineHeight: 1 }}>
            {k.big}
          </div>
          <div className="t-mono ink-60" style={{ fontSize: 10.5, marginTop: 4 }}>
            {k.sub}
          </div>
        </div>
      ))}
      <div
        style={{
          paddingLeft: 22,
          borderLeft: '1px solid var(--hairline-color)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 8,
          minWidth: 0,
        }}
      >
        <div className="t-meta" style={{ fontSize: 10 }}>
          Quick commands
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {QUICK_COMMANDS.map(q => (
            <span
              key={q.k}
              className="t-mono"
              style={{
                fontSize: 10.5,
                padding: '4px 9px',
                background: 'var(--surface-floating)',
                boxShadow: 'inset 0 0 0 1px var(--hairline-color)',
                borderRadius: 14,
                cursor: 'pointer',
              }}
            >
              <span style={{ color: 'var(--vermillion)', fontWeight: 600 }}>{q.k}</span>
              <span style={{ color: 'var(--ink-60)', marginLeft: 5 }}>{q.hint}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// Nanopay + Workflows live feed.
//
// Two complementary data sources merge here:
//   · `conversation` tool entries — the in-flight per-tool calls
//     streamed from useChat. These give the panel its real-time feel:
//     a `book_flight` row appears the instant the tool starts.
//   · `meterEvents` — server-confirmed MeterEvent rows fanned out via
//     the `/api/meter/stream` SSE endpoint. One row per agent turn
//     (`chat_reply` with `metadata.toolNames`). These carry the
//     authoritative price.
//
// Running total prefers the real meter sum when present and falls
// back to a heuristic per-tool estimate while the turn is still
// streaming. Per-tool ledger rows always come from the conversation
// so the operator sees what's happening, not just what's settled.
//
// `scope` flips the framing: 'session' for the unscoped console
// (running total = whole session), 'trip' for `/dashboard/inbox/[id]`
// (running total = trip cost). When scoped, `channelAccent` bleeds
// through the running-total color so the terminal feels like part of
// the channel (whatsapp green, slack purple, sms midnight…).
const PRICE_HINT_USD: Record<string, number> = {
  search_flights: 0.02,
  search_hotels: 0.02,
  check_policy: 0.001,
  quote_fx: 0.01,
  hold_booking: 0.15,
  book_flight: 1.0,
  confirm_booking: 1.0,
  modify_booking: 1.5,
  cancel_booking: 1.5,
  // legacy / friendlier display names that may appear from older tool
  // shapes — kept so the panel never falls back to the floor price for
  // recognizable calls during the migration window.
  'duffel.search': 0.084,
  'duffel.hold': 0.15,
  'duffel.book': 1.0,
  'policy.check': 0.001,
  'trips.query': 0.001,
};
const PRICE_FLOOR_USD = 0.0008;
const microToUsd = (micro: string): number => Number(BigInt(micro)) / 1_000_000;

function NanopayWorkflowsPanel({
  conversation,
  meterEvents,
  scope,
  tripId,
  channelAccent,
}: {
  conversation: ConversationEntry[];
  meterEvents?: LiveMeterEvent[];
  scope: 'session' | 'trip';
  tripId?: string | null;
  channelAccent?: string;
}) {
  const toolEntries = conversation.filter(e => e.role === 'tool' && e.toolName);
  const isHold = (name: string) =>
    name === 'hold_booking' || name === 'duffel.hold' || /\bhold\b/i.test(name);

  // Per-tool ledger rows — always from the live conversation.
  const ledger = toolEntries
    .slice(-12)
    .map(e => {
      const tool = e.toolName ?? 'unknown';
      return {
        id: e.id,
        tool,
        cost: PRICE_HINT_USD[tool] ?? PRICE_FLOOR_USD,
        status: isHold(tool) ? 'held' : 'captured',
      };
    })
    .reverse();

  // Running total. Prefer server-confirmed meter rows; if none have
  // landed yet (turn still streaming, or stream not connected), fall
  // back to the heuristic ledger sum so the operator still sees motion.
  const confirmedTotal = (meterEvents ?? []).reduce((a, m) => a + microToUsd(m.priceMicroUsdc), 0);
  const heuristicTotal = ledger.reduce((a, r) => a + r.cost, 0);
  const total = confirmedTotal > 0 ? confirmedTotal : heuristicTotal;
  const captured = ledger.filter(r => r.status === 'captured').reduce((a, b) => a + b.cost, 0);
  const held = ledger.filter(r => r.status === 'held').reduce((a, b) => a + b.cost, 0);

  // Channel accent bleed — only meaningful when scoped to a channel.
  // The display swaps from sand (#E8B98E) to whatever the channel ink
  // is so the terminal reads as part of the same conversation.
  const totalColor =
    scope === 'trip' && channelAccent
      ? `color-mix(in oklab, ${channelAccent} 70%, #fdfbf7 30%)`
      : '#fdfbf7';
  const accentColor = scope === 'trip' && channelAccent ? channelAccent : '#E8B98E';
  const turnsLabel = scope === 'trip' ? 'metered turns' : 'turns';

  return (
    <div
      style={{
        background: 'var(--surface-terminal, #0E1424)',
        color: '#fdfbf7',
        marginLeft: 12,
        borderRadius: 12,
        padding: '16px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        overflow: 'auto',
      }}
    >
      {/* terminal title bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ display: 'flex', gap: 5 }}>
          <span style={{ width: 9, height: 9, borderRadius: 5, background: '#FF5F57' }} />
          <span style={{ width: 9, height: 9, borderRadius: 5, background: '#FEBC2E' }} />
          <span style={{ width: 9, height: 9, borderRadius: 5, background: '#28C840' }} />
        </div>
        <span
          className="t-mono"
          style={{ fontSize: 11, color: 'rgba(253,251,247,0.5)', marginLeft: 6 }}
        >
          nanopay.terminal
        </span>
        <span style={{ flex: 1 }} />
        <span
          aria-hidden
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            background: accentColor,
            boxShadow: `0 0 6px ${accentColor}`,
          }}
        />
        <span className="t-mono" style={{ fontSize: 10, color: 'rgba(253,251,247,0.5)' }}>
          live
        </span>
      </div>

      {/* running total */}
      <div>
        <div className="t-meta" style={{ color: 'rgba(253,251,247,0.5)' }}>
          {scope === 'trip' ? `Trip cost${tripId ? ` · ${tripId}` : ''}` : 'Session spend · x402'}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 4 }}>
          <span
            className="t-num-lg"
            style={{
              fontSize: 30,
              color: totalColor,
              fontFamily: 'var(--font-display, var(--font-serif, serif))',
            }}
          >
            ${total.toFixed(4)}
          </span>
          <span className="t-mono" style={{ fontSize: 11, color: accentColor }}>
            {meterEvents?.length ?? 0} {turnsLabel}
          </span>
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: 8,
            fontSize: 10,
            color: 'rgba(253,251,247,0.55)',
          }}
        >
          <span className="t-mono">captured ${captured.toFixed(4)}</span>
          <span className="t-mono">held ${held.toFixed(4)}</span>
        </div>
        {confirmedTotal === 0 && heuristicTotal > 0 ? (
          <div
            className="t-mono"
            style={{ fontSize: 9, color: 'rgba(253,251,247,0.4)', marginTop: 6 }}
          >
            estimate · settles when turn finishes
          </div>
        ) : null}
      </div>

      {/* live ledger — fed by useChat tool parts */}
      <div>
        <div className="t-meta" style={{ color: 'rgba(253,251,247,0.5)', marginBottom: 8 }}>
          Live ledger
        </div>
        {ledger.length === 0 ? (
          <div
            className="t-mono"
            style={{
              fontSize: 11,
              color: 'rgba(253,251,247,0.4)',
              padding: '8px 0',
              lineHeight: 1.55,
            }}
          >
            No tool calls yet. Ask Sendero anything — every call meters here as it streams.
          </div>
        ) : (
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, lineHeight: 1.7 }}>
            {ledger.map((row, i) => (
              <div
                key={row.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 60px 50px',
                  gap: 6,
                  padding: '2px 0',
                  borderBottom: i < ledger.length - 1 ? '1px solid rgba(253,251,247,0.06)' : 'none',
                }}
              >
                <span style={{ color: row.status === 'held' ? '#E26B47' : '#fdfbf7' }}>
                  {row.tool}
                </span>
                <span style={{ color: accentColor, textAlign: 'right' }}>
                  ${row.cost.toFixed(4)}
                </span>
                <span
                  style={{
                    color: row.status === 'held' ? '#E26B47' : 'rgba(253,251,247,0.5)',
                    fontSize: 9,
                    textTransform: 'uppercase',
                    textAlign: 'right',
                  }}
                >
                  {row.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* settled turns — server-confirmed history. Only renders once
          the SSE stream has delivered at least one row. */}
      {(meterEvents?.length ?? 0) > 0 ? (
        <div>
          <div className="t-meta" style={{ color: 'rgba(253,251,247,0.5)', marginBottom: 8 }}>
            Settled turns
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, lineHeight: 1.7 }}>
            {(meterEvents ?? [])
              .slice(-6)
              .reverse()
              .map(evt => {
                const tools = evt.toolNames ?? [];
                const summary = tools.length > 0 ? tools.slice(0, 2).join(', ') : 'chat_reply';
                const more = tools.length > 2 ? ` +${tools.length - 2}` : '';
                return (
                  <div
                    key={evt.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 64px 56px',
                      gap: 6,
                      padding: '2px 0',
                      borderBottom: '1px solid rgba(253,251,247,0.04)',
                    }}
                  >
                    <span style={{ color: 'rgba(253,251,247,0.85)' }}>
                      {summary}
                      {more}
                    </span>
                    <span style={{ color: accentColor, textAlign: 'right' }}>
                      ${microToUsd(evt.priceMicroUsdc).toFixed(4)}
                    </span>
                    <span
                      style={{
                        color: evt.status === 'sandbox' ? '#E26B47' : 'rgba(253,251,247,0.5)',
                        fontSize: 9,
                        textTransform: 'uppercase',
                        textAlign: 'right',
                      }}
                    >
                      {evt.status}
                    </span>
                  </div>
                );
              })}
          </div>
        </div>
      ) : null}

      {/* workflow trail — settlement timeline keyed off the ledger */}
      <div>
        <div className="t-meta" style={{ color: 'rgba(253,251,247,0.5)', marginBottom: 8 }}>
          Workflow
        </div>
        {[
          { k: 'Dispatch', t: 'agent.turn', done: ledger.length > 0 },
          { k: 'Tool calls', t: `${ledger.length} streamed`, done: ledger.length > 0 },
          {
            k: 'Settled',
            t: `${meterEvents?.length ?? 0} turn${(meterEvents?.length ?? 0) === 1 ? '' : 's'}`,
            done: (meterEvents?.length ?? 0) > 0,
          },
          { k: 'Settle batch', t: 'on cron', done: false },
        ].map((s, i, arr) => (
          <div
            key={s.k}
            style={{ display: 'flex', gap: 10, paddingBottom: 10, position: 'relative' }}
          >
            {i < arr.length - 1 ? (
              <div
                style={{
                  position: 'absolute',
                  left: 5,
                  top: 14,
                  bottom: 0,
                  width: 1,
                  background: 'rgba(253,251,247,0.2)',
                }}
              />
            ) : null}
            <div
              style={{
                width: 11,
                height: 11,
                borderRadius: 6,
                marginTop: 4,
                flexShrink: 0,
                background: s.done ? accentColor : 'transparent',
                boxShadow: s.done ? 'none' : 'inset 0 0 0 1px rgba(253,251,247,0.3)',
              }}
            />
            <div style={{ flex: 1 }}>
              <div
                className="t-mono"
                style={{ fontSize: 11, color: s.done ? '#fdfbf7' : 'rgba(253,251,247,0.6)' }}
              >
                {s.k}
              </div>
              <div
                className="t-mono"
                style={{ fontSize: 10, color: 'rgba(253,251,247,0.4)', marginTop: 1 }}
              >
                {s.t}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function NanopaySwitch({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={open}
      onClick={onToggle}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        background: 'transparent',
        border: 0,
        padding: '4px 6px',
        cursor: 'pointer',
      }}
    >
      <span className="t-mono ink-60" style={{ fontSize: 10.5 }}>
        Nanopay terminal
      </span>
      <span
        aria-hidden
        style={{
          position: 'relative',
          width: 26,
          height: 14,
          borderRadius: 7,
          background: open ? 'var(--vermillion)' : 'rgba(31,42,68,0.2)',
          transition: 'background 120ms ease',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 2,
            left: open ? 14 : 2,
            width: 10,
            height: 10,
            borderRadius: 5,
            background: '#fdfbf7',
            transition: 'left 120ms ease',
            boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
          }}
        />
      </span>
    </button>
  );
}
