/**
 * Channel header chip — runs along the top of the conversation pane.
 *
 * Two modes:
 *   - Channel scope (whatsapp/slack/sms/email/web): rendered in the
 *     channel's tint colour with handle + traveler name + optional
 *     hold-expires countdown.
 *   - Internal scope: ink-toned banner with the operator-AI tagline.
 *     Dismissible — ✕ closes it and persists the choice in a cookie
 *     so the operator only sees it on their first authed session.
 */

'use client';

import { useEffect, useState } from 'react';

import { type ChannelKey, CHANNELS } from './channels';

interface ChannelHeaderProps {
  channel: ChannelKey;
  traveler?: string;
  tripId?: string;
  /** Countdown text like "59:48" — colours vermillion when present. */
  hold?: string | null;
}

const INTERNAL_NOTICE_COOKIE = 'sendero.console.internalNotice.dismissed';

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[2]) : null;
}

function writeCookie(name: string, value: string, days = 365) {
  if (typeof document === 'undefined') return;
  const exp = new Date(Date.now() + days * 86400_000).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${exp}; path=/; SameSite=Lax`;
}

export function ChannelHeader({ channel, traveler, tripId, hold }: ChannelHeaderProps) {
  const c = CHANNELS[channel];
  const [internalNoticeOpen, setInternalNoticeOpen] = useState(false);
  // Hydrate the cookie on mount. SSR renders nothing for the notice
  // so it can't flash before dismissal state lands.
  useEffect(() => {
    if (channel !== 'internal') return;
    setInternalNoticeOpen(readCookie(INTERNAL_NOTICE_COOKIE) !== '1');
  }, [channel]);

  const dismissInternalNotice = () => {
    writeCookie(INTERNAL_NOTICE_COOKIE, '1');
    setInternalNoticeOpen(false);
  };

  if (channel === 'internal') {
    if (!internalNoticeOpen) return null;
    return (
      <div
        role="status"
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '10px 14px',
          borderRadius: 10,
          background: 'var(--ink)',
          color: '#fdfbf7',
          boxShadow: 'inset 0 0 0 1px rgba(253,251,247,0.14)',
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 16,
            background: 'rgba(253,251,247,0.12)',
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <span style={{ fontSize: 14 }}>🛡</span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span className="t-body" style={{ fontSize: 14, fontWeight: 600, color: '#fdfbf7' }}>
              Sendero AI · operator console
            </span>
            <span className="t-mono" style={{ fontSize: 11, color: 'rgba(253,251,247,0.85)' }}>
              private
            </span>
          </div>
          <div
            className="t-mono"
            style={{ fontSize: 11, color: 'rgba(253,251,247,0.7)', marginTop: 2 }}
          >
            nothing here is sent to customers · run reports, change policy, ask anything
          </div>
        </div>
        <span
          className="t-mono"
          style={{
            fontSize: 10,
            color: '#fdfbf7',
            padding: '4px 8px',
            background: 'rgba(253,251,247,0.16)',
            borderRadius: 4,
            fontWeight: 600,
            letterSpacing: '0.04em',
          }}
        >
          INTERNAL
        </span>
        <button
          type="button"
          onClick={dismissInternalNotice}
          aria-label="Dismiss notice"
          title="Don't show again"
          style={{
            position: 'absolute',
            top: -8,
            right: -8,
            zIndex: 50,
            width: 22,
            height: 22,
            borderRadius: 11,
            border: 0,
            background: '#fdfbf7',
            color: 'var(--ink)',
            cursor: 'pointer',
            display: 'grid',
            placeItems: 'center',
            padding: 0,
            fontSize: 11,
            fontFamily: 'var(--font-mono)',
            lineHeight: 1,
            boxShadow: '0 1px 4px rgba(0,0,0,0.18)',
          }}
        >
          ✕
        </button>
      </div>
    );
  }
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '10px 14px',
        borderRadius: 10,
        background: c.tint,
        boxShadow: 'inset 0 0 0 1px rgba(31,42,68,0.08)',
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 16,
          background: '#fdfbf7',
          display: 'grid',
          placeItems: 'center',
          boxShadow: '0 1px 2px rgba(31,42,68,0.08)',
        }}
      >
        {c.icon(18)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span className="t-body" style={{ fontSize: 14, fontWeight: 600 }}>
            {traveler ?? 'Traveler'}
          </span>
          {tripId ? (
            <span className="t-mono ink-60" style={{ fontSize: 11 }}>
              {tripId}
            </span>
          ) : null}
        </div>
        <div
          className="t-mono"
          style={{ fontSize: 11, color: c.accent, marginTop: 2, fontWeight: 500 }}
        >
          {c.name} · {c.handle}
        </div>
      </div>
      {hold ? (
        <div style={{ textAlign: 'right' }}>
          <div className="t-meta">Hold expires</div>
          <div className="t-num-md" style={{ fontSize: 16, color: 'var(--vermillion)' }}>
            {hold}
          </div>
        </div>
      ) : null}
    </div>
  );
}
