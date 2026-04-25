/**
 * Channel header chip — runs along the top of the conversation pane.
 *
 * Two modes:
 *   - Channel scope (whatsapp/slack/sms/email/web): rendered in the
 *     channel's tint colour with handle + traveler name + optional
 *     hold-expires countdown.
 *   - Internal scope: dark midnight bar with the operator-AI tagline
 *     and a "PRIVATE / INTERNAL" pill so it's impossible to confuse
 *     this view with a customer-facing thread.
 */

import { type ChannelKey, CHANNELS } from './channels';

interface ChannelHeaderProps {
  channel: ChannelKey;
  traveler?: string;
  tripId?: string;
  /** Countdown text like "59:48" — colours vermillion when present. */
  hold?: string | null;
}

export function ChannelHeader({ channel, traveler, tripId, hold }: ChannelHeaderProps) {
  const c = CHANNELS[channel];
  if (channel === 'internal') {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '10px 14px',
          borderRadius: 10,
          background: 'var(--midnight)',
          color: '#fdfbf7',
          boxShadow: 'inset 0 0 0 1px rgba(253,251,247,0.1)',
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 16,
            background: 'rgba(253,251,247,0.08)',
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
            <span className="t-mono" style={{ fontSize: 11, color: '#e8b98e' }}>
              private
            </span>
          </div>
          <div
            className="t-mono"
            style={{ fontSize: 11, color: 'rgba(253,251,247,0.6)', marginTop: 2 }}
          >
            nothing here is sent to customers · run reports, change policy, ask anything
          </div>
        </div>
        <span
          className="t-mono"
          style={{
            fontSize: 10,
            color: '#e8b98e',
            padding: '4px 8px',
            background: 'rgba(232,185,142,0.12)',
            borderRadius: 4,
            fontWeight: 600,
            letterSpacing: '0.04em',
          }}
        >
          INTERNAL
        </span>
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
