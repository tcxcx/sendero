'use client';

/**
 * UnifiedConversation — channel-mode trip event-log render.
 *
 * Renders trip events in channel mode (the unified view of inbound
 * traveler messages, outbound operator replies, agent system notes,
 * tool calls, and tool results) with an optional channel-filter chip
 * rail at the top. Used by `ConsoleConversation` in the
 * `@conversation` parallel-routes slot.
 *
 * Lifted out of the deleted `meta-inbox.tsx` in Phase B-δ. The file
 * previously held this component plus the entire MetaInbox/MetaInboxLive
 * monolith (1,600+ lines) for /dashboard/inbox/[tripId]. With the
 * inbox detail route migrated to a redirect, the only surviving piece
 * worth keeping is this conversation render.
 */

import { useMemo, useState } from 'react';

import { CHANNELS, type ChannelKey } from './channels';
import type { UnifiedMessage } from '@/lib/unified-message';

const FILTER_OPTIONS: ReadonlyArray<{ key: 'all' | ChannelKey; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'internal', label: 'Private' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'slack', label: 'Slack' },
  { key: 'web', label: 'Web' },
  { key: 'email', label: 'Email' },
  { key: 'sms', label: 'SMS' },
];

export function UnifiedConversation({
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
