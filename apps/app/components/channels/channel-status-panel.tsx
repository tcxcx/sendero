'use client';

/**
 * ChannelStatusPanel — not-installed / pending / error state for the
 * channel hub pages, restyled with the design tokens.  Health-check
 * "Run probe" still calls the Kapso server action (`onProbe`).
 */

import { useTransition } from 'react';
import { CheckCircle2, AlertTriangle, Loader2, RefreshCw, ExternalLink } from 'lucide-react';
import Link from 'next/link';

export type ChannelStatusKind = 'active' | 'pending' | 'disabled' | 'error' | 'not_installed';

export interface ChannelStatusPanelProps {
  brand: 'whatsapp' | 'slack';
  status: ChannelStatusKind;
  /** Display name (WhatsApp display number / Slack team name). */
  identifier: string | null;
  lastHealthyAt: string | null;
  lastErrorMessage: string | null;
  /** Onboarding URL to (re)connect. */
  connectHref: string;
  /** Server action that re-pings the channel and revalidates the page. */
  onProbe?: () => Promise<{ ok: boolean; message?: string } | void>;
}

const STATUS_COPY: Record<
  ChannelStatusKind,
  { label: string; tone: 'sea' | 'sand' | 'verm' | 'outline' }
> = {
  active: { label: 'Connected', tone: 'sea' },
  pending: { label: 'Pending', tone: 'sand' },
  disabled: { label: 'Disabled', tone: 'outline' },
  error: { label: 'Error', tone: 'verm' },
  not_installed: { label: 'Not connected', tone: 'outline' },
};

export function ChannelStatusPanel({
  brand,
  status,
  identifier,
  lastHealthyAt,
  lastErrorMessage,
  connectHref,
  onProbe,
}: ChannelStatusPanelProps) {
  const [pending, start] = useTransition();
  const copy = STATUS_COPY[status];
  const brandName = brand === 'whatsapp' ? 'WhatsApp' : 'Slack';
  const lastHealthyLabel = lastHealthyAt ? formatRelative(new Date(lastHealthyAt)) : '—';

  return (
    <section
      className="sd-card-raised"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        padding: '20px 24px',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <span
          className={`sd-pill sd-pill-${copy.tone}`}
          style={{
            fontSize: 9,
            padding: '3px 10px',
            fontWeight: 700,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
          aria-label={`${brandName} channel status: ${copy.label}`}
        >
          {copy.tone === 'sea' ? (
            <CheckCircle2 className="size-3" aria-hidden="true" />
          ) : copy.tone === 'verm' ? (
            <AlertTriangle className="size-3" aria-hidden="true" />
          ) : null}
          {copy.label}
        </span>
        {identifier ? (
          <span className="t-mono" style={{ fontSize: 12, color: 'var(--midnight)' }}>
            {identifier}
          </span>
        ) : null}
        <span style={{ flex: 1 }} />
        {onProbe ? (
          <button
            type="button"
            disabled={pending || status === 'not_installed'}
            onClick={() =>
              start(async () => {
                await onProbe();
              })
            }
            style={{
              ...ghostBtnStyle,
              opacity: pending || status === 'not_installed' ? 0.5 : 1,
              cursor: pending || status === 'not_installed' ? 'not-allowed' : 'pointer',
            }}
          >
            {pending ? (
              <Loader2 className="size-3 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="size-3" aria-hidden="true" />
            )}
            {pending ? 'Probing…' : 'Run health check'}
          </button>
        ) : null}
        <Link href={connectHref} style={primaryBtnStyle}>
          {status === 'not_installed' ? 'Connect' : 'Manage install'}
          <ExternalLink className="size-3" style={{ marginLeft: 6 }} aria-hidden="true" />
        </Link>
      </header>

      <dl
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 16,
          margin: 0,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <dt className="t-meta">Last healthy</dt>
          <dd className="t-mono" style={{ margin: 0, fontSize: 12, color: 'var(--midnight)' }}>
            {lastHealthyLabel}
          </dd>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <dt className="t-meta">Last error</dt>
          <dd style={{ margin: 0 }}>
            {lastErrorMessage ? (
              <code
                className="t-mono"
                style={{
                  fontSize: 11,
                  color: 'var(--vermillion)',
                  wordBreak: 'break-word',
                }}
              >
                {lastErrorMessage}
              </code>
            ) : (
              <span className="t-body ink-70" style={{ fontSize: 13 }}>
                None recorded
              </span>
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
}

function formatRelative(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

const primaryBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '6px 12px',
  background: 'var(--vermillion)',
  color: '#fdfbf7',
  border: 0,
  borderRadius: 8,
  fontSize: 11,
  fontWeight: 600,
  fontFamily: 'var(--font-mono-x)',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  cursor: 'pointer',
  textDecoration: 'none',
};

const ghostBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 12px',
  background: 'transparent',
  color: 'var(--midnight)',
  border: 0,
  boxShadow: 'inset 0 0 0 1px var(--hairline-color)',
  borderRadius: 8,
  fontSize: 11,
  fontWeight: 600,
  fontFamily: 'var(--font-mono-x)',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
};
