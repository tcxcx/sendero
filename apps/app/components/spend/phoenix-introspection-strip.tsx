/**
 * PhoenixIntrospectionStrip — agent self-improvement at a glance.
 *
 * Renders inside /dashboard/spend below the SpendDashboard. Three
 * tiles: self-heals this week, cumulative resolutions in the Phoenix
 * dataset, Phoenix sync state. Plus a deep-link out to the Phoenix
 * workspace UI for operators who want the full trace tree.
 *
 * Pure server component — counts come from Postgres at page-load
 * time (cheap), env probe for Phoenix configuration. No client JS.
 *
 * Design language matches the rest of /dashboard/spend (sd-card-flat
 * + hairline + t-meta / t-num-lg / t-mono ink-60).
 */

interface Props {
  /** KnowledgeGap rows resolved in the last 7 days for this tenant. */
  resolvedThisWeek: number;
  /** All-time resolved KnowledgeGap rows for this tenant — proxy for
   *  the Phoenix `sendero-resolved-gaps` dataset size after PR4 cron
   *  catches up. */
  resolvedTotal: number;
  /** Open KnowledgeGap rows still on the board for this tenant. */
  openGaps: number;
  /** Phoenix workspace path or null when Phoenix is not configured. */
  phoenixWorkspace: string | null;
}

export function PhoenixIntrospectionStrip({
  resolvedThisWeek,
  resolvedTotal,
  openGaps,
  phoenixWorkspace,
}: Props) {
  const phoenixUrl = phoenixWorkspace
    ? `https://app.phoenix.arize.com/s/${phoenixWorkspace}`
    : null;

  return (
    <div
      className="sd-card-flat"
      style={{
        boxShadow: 'inset 0 0 0 1px var(--hairline-color)',
        padding: 0,
      }}
    >
      <div
        style={{
          padding: '14px 24px',
          borderBottom: '1px solid var(--hairline-color)',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div className="t-meta">Agent self-improvement</div>
          <div className="t-mono ink-60" style={{ fontSize: 11, marginTop: 4 }}>
            Phoenix-backed recall + self-heal · compounds nightly via{' '}
            <code style={{ fontSize: 11 }}>phoenix-promote-resolutions</code> cron · spec{' '}
            <code style={{ fontSize: 11 }}>docs/specs/arize-phoenix-integration.md</code>
          </div>
        </div>
        {phoenixUrl ? (
          <a
            href={phoenixUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="t-mono"
            style={{
              fontSize: 11,
              whiteSpace: 'nowrap',
              textDecoration: 'underline',
              textUnderlineOffset: 3,
            }}
          >
            Open Phoenix ↗
          </a>
        ) : (
          <span className="t-mono ink-60" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
            Not configured
          </span>
        )}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'stretch',
          padding: '4px 0',
        }}
      >
        <Tile
          label="Self-heals this week"
          value={resolvedThisWeek.toLocaleString()}
          sub="Resolved KnowledgeGaps · feeds find_resolved_gap"
          isFirst
        />
        <Tile
          label="Resolutions in dataset"
          value={resolvedTotal.toLocaleString()}
          sub="Cumulative · sendero-resolved-gaps"
        />
        <Tile
          label="Open gaps"
          value={openGaps.toLocaleString()}
          sub={
            openGaps === 0
              ? 'No agent struggles · clean board'
              : 'Awaiting triage in docs/agent-gaps/board.md'
          }
          isLast
        />
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
  isFirst,
  isLast,
}: {
  label: string;
  value: string;
  sub: string;
  isFirst?: boolean;
  isLast?: boolean;
}) {
  return (
    <div
      style={{
        flex: 1,
        padding: '14px 24px 16px',
        borderRight: isLast ? 'none' : '1px solid var(--hairline-color)',
        borderLeft: isFirst ? 'none' : undefined,
        minWidth: 0,
      }}
    >
      <div className="t-meta">{label}</div>
      <div
        className="t-num-lg"
        style={{
          fontSize: 'clamp(18px, 3vw, 32px)',
          marginTop: 6,
          lineHeight: 1,
          fontVariantNumeric: 'tabular-nums',
          overflowWrap: 'anywhere',
        }}
      >
        {value}
      </div>
      <div className="t-mono ink-60" style={{ fontSize: 11, marginTop: 6 }}>
        {sub}
      </div>
    </div>
  );
}
