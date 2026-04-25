/**
 * SlackConnectedPanel — design-canvas SlackA layout.
 *
 *   3-card metric strip (Workspace / Bot / Permissions) + Channel
 *   routing table reading the live `SlackInstall.routing` JSON via
 *   the parent page. Mode column distinguishes default / filter /
 *   escalation / silent — each gets a tone pill.
 *
 * Kapso plumbing is unchanged: routing rows come straight from the
 * persisted JSON shape.  No demo data.
 */

import Link from 'next/link';

interface SlackConnectedProps {
  teamName: string;
  enterpriseLabel: string | null;
  botUserId: string;
  scopeCount: number;
  routes: Array<{
    channelLabel: string;
    description: string;
    mode: 'route' | 'filter' | 'silent' | 'default' | 'escalation';
  }>;
  weeklyEscalations: number;
}

export function SlackConnectedPanel({
  teamName,
  enterpriseLabel,
  botUserId,
  scopeCount,
  routes,
  weeklyEscalations,
}: SlackConnectedProps) {
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
        <Link href="/dashboard/channels/slack/connect" style={primaryBtnStyle}>
          Add channel
        </Link>
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
        <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--hairline-color)' }}>
          <div className="t-h3">Channel routing</div>
          <div className="t-body ink-70" style={{ marginTop: 4, fontSize: 13 }}>
            Where Sendero posts what.
          </div>
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
          routes.map((r, i) => {
            const tone = r.mode === 'escalation' ? 'verm' : r.mode === 'silent' ? 'outline' : 'sea';
            return (
              <div
                key={`${r.channelLabel}-${i}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '180px 1fr 120px 80px',
                  padding: '14px 24px',
                  borderBottom:
                    i < routes.length - 1 ? '1px solid var(--hairline-color-soft)' : 'none',
                  alignItems: 'center',
                }}
              >
                <div className="t-mono" style={{ fontSize: 12 }}>
                  {r.channelLabel}
                </div>
                <div className="t-body" style={{ fontSize: 13 }}>
                  {r.description}
                </div>
                <span
                  className="sd-pill sd-pill-outline"
                  style={{ fontSize: 9, padding: '2px 7px', fontWeight: 700 }}
                >
                  {r.mode}
                </span>
                <span
                  className={`sd-pill sd-pill-${tone}`}
                  style={{ fontSize: 9, padding: '2px 7px', fontWeight: 700 }}
                >
                  {tone === 'verm' ? 'ROUTE' : tone === 'sea' ? 'ROUTE' : 'SILENT'}
                </span>
              </div>
            );
          })
        )}
      </article>
    </section>
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
