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
  conversation: ConversationEntry[];
  /** Optional traveler info — drives the scoped header. */
  traveler?: {
    name: string;
    initials: string;
  } | null;
  /** Hold-expires countdown ("59:48") when status === 'awaiting hold'. */
  holdExpires?: string | null;
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

  // Column template adapts to which side panel is open.
  const baseCols = isTrip ? '260px 1fr' : '320px 1fr';
  const cols = baseCols + (customerPanelOpen ? ' 320px' : '');

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
              {isTrip ? 'Approve hold' : 'Run a report'}
            </button>
          </div>
        </div>

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

          {/* RIGHT — customer / context panel */}
          {customerPanelOpen ? (
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
                <span className="t-meta">{isTrip ? 'Customer' : 'Workspace summary'}</span>
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

              {isTrip && focused ? (
                <TripContextCards trip={focused} channel={channel} />
              ) : (
                <ConsoleSummaryCards />
              )}
            </div>
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
            {!customerPanelOpen ? (
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
                ◧ Show {isTrip ? 'customer' : 'workspace'} panel
              </button>
            ) : null}
            <NanopaySwitch open={nanopayOpen} onToggle={() => setNanopayOpen(o => !o)} />
          </div>
          {nanopayOpen ? (
            <div
              style={{
                padding: '0 18px 14px',
                borderTop: '1px solid var(--hairline-color)',
              }}
            >
              <div style={{ paddingTop: 12 }}>
                <NanopayTerminal />
              </div>
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

function ConsoleSummaryCards() {
  const KPIS = [
    { label: 'Today', big: '24', sub: 'trips in flight · 4 awaiting' },
    { label: 'Settled 30d', big: '312', sub: '$74,820 total fare' },
    { label: 'Avg response', big: '11s', sub: 'agent latency' },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {KPIS.map(k => (
        <div
          key={k.label}
          className="sd-card-flat"
          style={{ boxShadow: 'inset 0 0 0 1px var(--hairline-color)', padding: '14px 16px' }}
        >
          <div className="t-meta">{k.label}</div>
          <div className="t-num-lg" style={{ fontSize: 32, marginTop: 4, lineHeight: 1 }}>
            {k.big}
          </div>
          <div className="t-mono ink-60" style={{ fontSize: 10.5, marginTop: 6 }}>
            {k.sub}
          </div>
        </div>
      ))}
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

function NanopayTerminal() {
  return (
    <div
      style={{
        background: 'var(--surface-terminal)',
        color: '#f7efe4',
        borderRadius: 12,
        padding: '14px 16px',
        fontFamily: 'var(--font-mono-x)',
        fontSize: 11.5,
        lineHeight: 1.55,
      }}
    >
      <div className="t-meta" style={{ color: 'rgba(247,239,228,0.5)', marginBottom: 8 }}>
        x402 ledger · live
      </div>
      <div>
        <span style={{ color: '#9ed6bb' }}>$0.0010</span> trips.query · 14:00
      </div>
      <div>
        <span style={{ color: '#9ed6bb' }}>$0.0840</span> duffel.search · 12:14
      </div>
      <div>
        <span style={{ color: '#e8ba67' }}>$0.0050</span> check_policy · 12:14
      </div>
      <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(247,239,228,0.1)' }}>
        Total ·{' '}
        <span className="t-num-md" style={{ color: '#fdfbf7', fontSize: 13 }}>
          $2.39
        </span>
      </div>
    </div>
  );
}
