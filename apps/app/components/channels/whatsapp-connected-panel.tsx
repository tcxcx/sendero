'use client';

/**
 * WhatsappConnectedPanel — design-canvas WhatsappA layout.
 *
 *   3-card metric strip (Status / Number / Display name) above a
 *   1.2fr/1fr grid: recent conversations on the left, templates +
 *   weekly KPIs on the right. Reads only the fields we already
 *   compute for this tenant — no hardcoded counts or sample threads.
 *
 * Kapso plumbing is unchanged: the channel page server-renders this
 * with `displayName` + `displayPhoneNumber` from `WhatsAppInstall`,
 * `templates` from the `metadata.templates` JSON, real recent threads
 * from `ChannelIdentity` + `Trip`, and weekly aggregates from
 * `MeterEvent` + `Trip` counts.
 */

import { useState } from 'react';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface WhatsappConnectedProps {
  displayName: string | null;
  displayPhoneNumber: string | null;
  status: string;
  templates: Array<{ name: string; status: string }>;
  recentThreads: Array<{
    initial: string;
    name: string;
    snippet: string;
    timeAgo: string;
    badge?: 'NOW' | null;
  }>;
  weeklyStats: { trips: number; messages: number; deliveryRate: number };
  health?: {
    status: string | null;
    messagingStatus: string | null;
    webhookVerified: boolean | null;
    errors: string[];
  } | null;
}

export function WhatsappConnectedPanel({
  displayName,
  displayPhoneNumber,
  status,
  templates,
  recentThreads,
  weeklyStats,
  health,
}: WhatsappConnectedProps) {
  const router = useRouter();
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);

  const disconnect = async () => {
    setDisconnectError(null);
    setIsDisconnecting(true);
    console.info('[whatsapp connected panel] disconnect requested', {
      displayPhoneNumber,
      displayName,
    });
    try {
      const response = await fetch('/api/channels/whatsapp/install', {
        method: 'DELETE',
        headers: { Accept: 'application/json' },
      });
      const text = await response.text();
      const data = text ? safeJson(text) : null;
      console.info('[whatsapp connected panel] disconnect response', {
        status: response.status,
        ok: response.ok,
        data,
      });
      if (!response.ok) {
        const message =
          data && typeof data === 'object' && 'message' in data
            ? String(data.message)
            : data && typeof data === 'object' && 'error' in data
              ? String(data.error)
              : `Disconnect failed (HTTP ${response.status})`;
        setDisconnectError(message);
        return;
      }
      router.refresh();
    } catch (err) {
      console.warn('[whatsapp connected panel] disconnect failed', err);
      setDisconnectError(err instanceof Error ? err.message : 'Disconnect failed');
    } finally {
      setIsDisconnecting(false);
    }
  };

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 24,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h1 className="t-h1">WhatsApp</h1>
          <p className="t-body-lg ink-70" style={{ marginTop: 6, maxWidth: '60ch' }}>
            Connected via Kapso · {recentThreads.length} active thread
            {recentThreads.length === 1 ? '' : 's'} · {weeklyStats.trips} trip
            {weeklyStats.trips === 1 ? '' : 's'} this week
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={disconnect}
            disabled={isDisconnecting}
            style={ghostBtnStyle}
          >
            {isDisconnecting ? 'Disconnecting…' : 'Disconnect'}
          </button>
          <Link href="/dashboard/channels/whatsapp/connect" style={primaryBtnStyle}>
            Open settings
          </Link>
        </div>
      </header>
      {disconnectError ? (
        <div
          className="sd-card-flat"
          style={{
            border: '1px solid var(--accent-rose)',
            color: 'var(--accent-rose)',
            padding: '10px 12px',
            fontSize: 12,
          }}
        >
          {disconnectError}
        </div>
      ) : null}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 18,
        }}
      >
        <MetricCard label="Status" value={status} pillTone="sea" pillLabel="LIVE" />
        <MetricCard
          label="Number"
          value={displayPhoneNumber ?? '—'}
          pillTone="outline"
          pillLabel="SET"
          mono
        />
        <MetricCard
          label="Display name"
          value={displayName ?? '—'}
          pillTone="outline"
          pillLabel="SET"
        />
      </div>

      {health ? (
        <article
          className="sd-card-flat"
          style={{ boxShadow: 'inset 0 0 0 1px var(--hairline-color)', padding: '14px 16px' }}
        >
          <div className="t-meta">Meta readiness</div>
          <p className="t-body ink-70" style={{ marginTop: 8, fontSize: 13, lineHeight: 1.55 }}>
            Overall {health.status ?? 'unknown'} · messaging {health.messagingStatus ?? 'unknown'} ·
            webhook {health.webhookVerified ? 'verified' : 'waiting for first inbound message'}
          </p>
          {health.errors.length ? (
            <p className="t-body ink-70" style={{ marginTop: 8, fontSize: 13, lineHeight: 1.55 }}>
              {health.errors[0]}
            </p>
          ) : null}
        </article>
      ) : null}

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: '1.2fr 1fr',
          gap: 20,
        }}
      >
        <article
          className="sd-card-raised"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            overflow: 'hidden',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div className="t-h3">Recent conversations</div>
            <span className="t-mono ink-60" style={{ fontSize: 11 }}>
              last 24h
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {recentThreads.length === 0 ? (
              <div className="t-body ink-60" style={{ fontSize: 13, padding: '8px 0' }}>
                No threads yet. Travelers&rsquo; first messages will appear here.
              </div>
            ) : (
              recentThreads.map((t, i) => (
                <div
                  key={`${t.name}-${i}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                    padding: '10px 0',
                    borderBottom:
                      i < recentThreads.length - 1
                        ? '1px solid var(--hairline-color-soft)'
                        : 'none',
                  }}
                >
                  <div
                    aria-hidden
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 18,
                      background: 'var(--surface-floating)',
                      display: 'grid',
                      placeItems: 'center',
                      fontFamily: 'var(--font-display)',
                      fontWeight: 500,
                      color: 'var(--midnight)',
                      flexShrink: 0,
                    }}
                  >
                    {t.initial}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="t-body" style={{ fontWeight: 500, fontSize: 13 }}>
                      {t.name}
                    </div>
                    <div className="t-body ink-70" style={{ fontSize: 13 }}>
                      {t.snippet}
                    </div>
                  </div>
                  {t.badge ? (
                    <span
                      className="sd-pill sd-pill-verm"
                      style={{ fontSize: 9, padding: '2px 7px', fontWeight: 700 }}
                    >
                      {t.badge}
                    </span>
                  ) : null}
                  <div
                    className="t-mono ink-60"
                    style={{ fontSize: 11, width: 36, textAlign: 'right' }}
                  >
                    {t.timeAgo}
                  </div>
                </div>
              ))
            )}
          </div>
        </article>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <article
            className="sd-card-flat"
            style={{ boxShadow: 'inset 0 0 0 1px var(--hairline-color)', padding: '14px 16px' }}
          >
            <div className="t-meta">Templates</div>
            {templates.length === 0 ? (
              <div className="t-body ink-60" style={{ fontSize: 12, marginTop: 8 }}>
                No templates submitted.
              </div>
            ) : (
              <ul
                className="t-body ink-70"
                style={{ margin: '10px 0 0', paddingLeft: 18, lineHeight: 1.7, fontSize: 13 }}
              >
                {templates.map(t => (
                  <li
                    key={t.name}
                    style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}
                  >
                    <span className="t-mono" style={{ fontSize: 12 }}>
                      {t.name}
                    </span>
                    <span
                      className="sd-pill sd-pill-outline"
                      style={{ fontSize: 9, padding: '2px 7px', fontWeight: 700 }}
                    >
                      {t.status}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </article>

          <article
            className="sd-card-flat"
            style={{
              boxShadow: 'inset 0 0 0 1px var(--hairline-color)',
              padding: '14px 16px',
              flex: 1,
            }}
          >
            <div className="t-meta">This week</div>
            <div
              style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, gap: 12 }}
            >
              <Stat label="Trips" value={weeklyStats.trips} />
              <Stat label="Messages" value={weeklyStats.messages} />
              <Stat label="Delivery" value={`${weeklyStats.deliveryRate}%`} />
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw.slice(0, 240);
  }
}

function MetricCard({
  label,
  value,
  pillTone,
  pillLabel,
  mono,
}: {
  label: string;
  value: string;
  pillTone: 'sea' | 'outline';
  pillLabel: string;
  mono?: boolean;
}) {
  return (
    <div
      className="sd-card-flat"
      style={{
        boxShadow: 'inset 0 0 0 1px var(--hairline-color)',
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div className="t-meta">{label}</div>
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
      >
        <div
          className="t-h3"
          style={mono ? { fontFamily: 'var(--font-mono-x)', fontSize: 16 } : undefined}
        >
          {value}
        </div>
        <span
          className={`sd-pill sd-pill-${pillTone}`}
          style={{ fontSize: 9, padding: '2px 7px', fontWeight: 700 }}
        >
          {pillLabel}
        </span>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', minWidth: 0 }}
    >
      <span
        className="t-num-md"
        style={{ fontSize: 24, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}
      >
        {value}
      </span>
      <span className="t-meta">{label}</span>
    </div>
  );
}

const primaryBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '8px 18px',
  background: 'var(--vermillion)',
  color: '#fdfbf7',
  border: 0,
  borderRadius: 8,
  fontSize: 12,
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
  padding: '8px 14px',
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
  cursor: 'pointer',
};
