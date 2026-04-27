'use client';

/**
 * SlackConnectedPanel — design-canvas SlackA layout.
 *
 *   3-card metric strip (Workspace / Bot / Permissions) + Channel
 *   routing table reading the live `SlackInstall.routing` JSON via
 *   the parent page. Mode column distinguishes default / filter /
 *   escalation / silent — each gets a tone pill.
 *
 * Marked `'use client'` because `RoutingRow` uses inline
 * onMouseEnter/onMouseLeave hover handlers — those event handlers
 * cannot be passed across the server→client component boundary in
 * App Router (Next throws "Event handlers cannot be passed to Client
 * Component props" at runtime).
 *
 * Kapso plumbing is unchanged: routing rows come straight from the
 * persisted JSON shape.  No demo data.
 */

import Link from 'next/link';

import { SlackInstallChannelManager, SlackInstallDisconnectButton } from './slack-install-actions';

interface SlackConnectedProps {
  installId: string;
  teamName: string;
  enterpriseLabel: string | null;
  botUserId: string;
  scopeCount: number;
  routes: Array<{
    channelId: string;
    channelLabel: string;
    description: string;
    mode: 'route' | 'filter' | 'silent' | 'default' | 'escalation';
  }>;
  weeklyEscalations: number;
}

export function SlackConnectedPanel({
  installId,
  teamName,
  enterpriseLabel,
  botUserId,
  scopeCount,
  routes,
  weeklyEscalations,
}: SlackConnectedProps) {
  // Surface unique channels for the per-channel "Leave" actions. Some
  // routing JSON shapes have multiple event-class rules pointing at the
  // same channel; the leave action removes ALL routes for the channel
  // anyway, so we de-dupe at the UI layer to avoid duplicate buttons.
  const seenChannels = new Set<string>();
  const uniqueChannels = routes
    .filter(r => {
      if (!r.channelId || seenChannels.has(r.channelId)) return false;
      seenChannels.add(r.channelId);
      return true;
    })
    .map(r => ({ channelId: r.channelId, channelLabel: r.channelLabel }));

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
          <h1 className="t-h1">Slack</h1>
          <p className="t-body-lg ink-70" style={{ marginTop: 6, maxWidth: '60ch' }}>
            Installed on {enterpriseLabel ?? teamName} · {routes.length} channel
            {routes.length === 1 ? '' : 's'} routed · {weeklyEscalations} escalation
            {weeklyEscalations === 1 ? '' : 's'} this week
          </p>
        </div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          <Link href="/dashboard/channels/slack/connect" style={primaryBtnStyle}>
            Add channel
          </Link>
          <SlackInstallDisconnectButton installId={installId} teamName={teamName} />
        </div>
      </header>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 18,
        }}
      >
        <MetricCard label="Workspace" value={teamName} pillTone="sea" pillLabel="LIVE" />
        <MetricCard
          label="Bot"
          value={`@sendero (${botUserId.slice(0, 12)}…)`}
          pillTone="sea"
          pillLabel="LIVE"
          mono
        />
        <MetricCard
          label="Permissions"
          value={`${scopeCount} scope${scopeCount === 1 ? '' : 's'}`}
          pillTone="outline"
          pillLabel="AUDIT"
        />
      </div>

      <article
        className="sd-card-raised"
        style={{
          padding: 0,
          overflow: 'hidden',
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            padding: '18px 24px',
            borderBottom: '1px solid var(--hairline-color)',
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            gap: 16,
          }}
        >
          <div>
            <div className="t-h3">Channel routing</div>
            <div className="t-body ink-70" style={{ marginTop: 4, fontSize: 13 }}>
              Where Sendero posts what.
            </div>
          </div>
          <Link
            href="/dashboard/channels/slack/connect"
            className="t-mono"
            style={{
              fontSize: 10,
              padding: '5px 10px',
              border: '1px solid color-mix(in oklab, var(--ink) 18%, transparent)',
              borderRadius: 6,
              color: 'var(--ink)',
              textDecoration: 'none',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            Edit routes
          </Link>
        </div>
        {routes.length === 0 ? (
          <div
            style={{
              padding: '20px 24px',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <span className="t-body" style={{ fontSize: 13, color: 'var(--midnight)' }}>
              No routes configured
            </span>
            <span className="t-body ink-70" style={{ fontSize: 12 }}>
              Pick channels in the wizard to start receiving events.
            </span>
          </div>
        ) : (
          <>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '200px 1fr 120px',
                padding: '10px 24px',
                background: 'color-mix(in oklab, var(--ink) 3%, transparent)',
                borderBottom: '1px solid var(--hairline-color-soft)',
              }}
            >
              <span className="t-meta">Channel</span>
              <span className="t-meta">Posts what</span>
              <span className="t-meta" style={{ textAlign: 'right' }}>
                Mode
              </span>
            </div>
            {routes.map((r, i) => (
              <RoutingRow key={`${r.channelLabel}-${i}`} row={r} last={i === routes.length - 1} />
            ))}
          </>
        )}
      </article>

      {/* Per-channel leave controls — collapsed by default so the table
          stays the focal element. Surfaces inside the same workspace
          panel since each install owns its own channel set. */}
      <SlackInstallChannelManager installId={installId} channels={uniqueChannels} />
    </section>
  );
}

function RoutingRow({
  row,
  last,
}: {
  row: {
    channelLabel: string;
    description: string;
    mode: SlackConnectedProps['routes'][number]['mode'];
  };
  last: boolean;
}) {
  const modeLabel = row.mode.toUpperCase();
  // Mode → tone. Two routing modes share the same "active" treatment
  // (default + route + escalation post) so the operator can scan the
  // table for SILENT/FILTER first — the cases that won't post.
  const tone =
    row.mode === 'escalation'
      ? 'verm'
      : row.mode === 'silent'
        ? 'outline'
        : row.mode === 'filter'
          ? 'sand'
          : 'sea';
  const modeColor =
    tone === 'verm'
      ? 'color-mix(in oklab, var(--vermillion, #fb542b) 14%, transparent)'
      : tone === 'sand'
        ? 'color-mix(in oklab, var(--sand, #B8A082) 22%, transparent)'
        : tone === 'outline'
          ? 'transparent'
          : 'color-mix(in oklab, var(--accent-green, #6A8570) 18%, transparent)';
  const modeText =
    tone === 'verm'
      ? 'var(--vermillion, #fb542b)'
      : tone === 'sand'
        ? 'var(--midnight, #1F2A44)'
        : tone === 'outline'
          ? 'var(--text-dim)'
          : 'var(--accent-green, #6A8570)';

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '200px 1fr 120px',
        padding: '14px 24px',
        borderBottom: last ? 'none' : '1px solid var(--hairline-color-soft)',
        alignItems: 'center',
        transition: 'background 120ms ease',
      }}
      onMouseEnter={e =>
        (e.currentTarget.style.background = 'color-mix(in oklab, var(--ink) 2%, transparent)')
      }
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      <div className="t-mono" style={{ fontSize: 12, color: 'var(--ink)' }}>
        {row.channelLabel}
      </div>
      <div className="t-body" style={{ fontSize: 13, color: 'var(--midnight)' }}>
        {row.description}
      </div>
      <span
        style={{
          justifySelf: 'end',
          fontFamily: 'var(--font-mono-x)',
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: '0.1em',
          padding: '4px 9px',
          borderRadius: 999,
          background: modeColor,
          color: modeText,
          border:
            tone === 'outline'
              ? '1px solid color-mix(in oklab, var(--ink) 16%, transparent)'
              : 'none',
        }}
      >
        {modeLabel}
      </span>
    </div>
  );
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
          style={mono ? { fontFamily: 'var(--font-mono-x)', fontSize: 14 } : undefined}
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
