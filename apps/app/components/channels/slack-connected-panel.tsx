/**
 * Rich connected-status panel for the Slack channel page.
 * Renders workspace + bot + permissions cards plus the channel routing
 * table from SlackInstall.routing.
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
    mode: 'route' | 'filter' | 'silent';
  }>;
  weeklyEscalations: number;
}

const TITLE_PILL =
  'font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--text-faint)]';

export function SlackConnectedPanel({
  teamName,
  enterpriseLabel,
  botUserId,
  scopeCount,
  routes,
  weeklyEscalations,
}: SlackConnectedProps) {
  return (
    <section className="flex flex-col gap-5 overflow-hidden rounded-[var(--radius-lg)] border border-[color:color-mix(in_oklab,var(--accent-rose)_45%,transparent)] bg-[color:var(--surface-raised)] p-6 shadow-[var(--shadow-md)]">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className={TITLE_PILL}>Channels · Slack</span>
          <h2 className="font-serif text-[clamp(36px,4vw,48px)] leading-[1] tracking-[-0.01em] text-[color:var(--ink)]">
            Slack
          </h2>
          <p className="text-sm text-[color:var(--text-dim)]">
            Installed on {enterpriseLabel ?? teamName} · {routes.length} channels routed ·{' '}
            {weeklyEscalations} escalations this week
          </p>
        </div>
        <Link
          href="/dashboard/channels/slack/connect"
          className="rounded-md bg-[color:var(--accent-rose)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-white transition-opacity hover:opacity-90"
        >
          Add channel
        </Link>
      </header>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <MetricCard label="Workspace" value={teamName} pill="LIVE" tone="ok" />
        <MetricCard label="Bot" value={`@sendero (${botUserId})`} pill="LIVE" tone="ok" mono />
        <MetricCard label="Permissions" value={`${scopeCount} scopes`} pill="AUDIT" />
      </div>

      <article className="flex flex-col gap-3 rounded-md border border-[color:color-mix(in_oklab,var(--ink)_10%,transparent)] bg-[color:var(--surface)] p-4">
        <header className="flex items-baseline justify-between">
          <h3 className="text-[14px] font-semibold text-[color:var(--ink)]">Channel routing</h3>
          <span className="text-[12px] text-[color:var(--text-dim)]">
            Where Sendero posts what.
          </span>
        </header>
        <table className="w-full table-fixed border-collapse">
          <tbody>
            {routes.map((r, i) => (
              <tr
                key={`${r.channelLabel}:${i}`}
                className="border-t border-[color:color-mix(in_oklab,var(--ink)_8%,transparent)] first:border-t-0"
              >
                <td className="w-44 py-2 pr-3 font-mono text-[12px] text-[color:var(--ink)]">
                  {r.channelLabel}
                </td>
                <td className="py-2 pr-3 text-[12px] text-[color:var(--text-dim)]">
                  {r.description}
                </td>
                <td className="w-24 py-2 pr-3">
                  <ModePill mode={r.mode} />
                </td>
                <td className="w-20 py-2">
                  <span className="inline-flex items-center rounded-full border border-[color:color-mix(in_oklab,var(--ink)_22%,transparent)] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-[color:var(--text-dim)]">
                    ROUTE
                  </span>
                </td>
              </tr>
            ))}
            {routes.length === 0 ? (
              <tr>
                <td className="py-3 text-[12px] text-[color:var(--text-dim)]" colSpan={4}>
                  No routes configured. Open settings to set them.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </article>
    </section>
  );
}

function MetricCard({
  label,
  value,
  pill,
  tone,
  mono,
}: {
  label: string;
  value: string;
  pill: string;
  tone?: 'ok';
  mono?: boolean;
}) {
  const pillCls =
    tone === 'ok'
      ? 'inline-flex items-center rounded-full bg-[color:var(--accent-green,#16a34a)] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-white'
      : 'inline-flex items-center rounded-full border border-[color:color-mix(in_oklab,var(--ink)_22%,transparent)] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-[color:var(--text-dim)]';
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-[color:color-mix(in_oklab,var(--ink)_10%,transparent)] bg-[color:var(--surface)] p-4">
      <div className="flex items-center justify-between">
        <span className={TITLE_PILL}>{label}</span>
        <span className={pillCls}>{pill}</span>
      </div>
      <span
        className={
          mono
            ? 'font-mono text-[16px] tracking-tight text-[color:var(--ink)]'
            : 'font-serif text-[20px] leading-tight text-[color:var(--ink)]'
        }
      >
        {value}
      </span>
    </div>
  );
}

function ModePill({ mode }: { mode: 'route' | 'filter' | 'silent' }) {
  const tone =
    mode === 'route'
      ? 'border-[color:var(--accent-green,#16a34a)] text-[color:var(--accent-green,#16a34a)]'
      : mode === 'filter'
        ? 'border-[color:var(--accent-amber,#d97706)] text-[color:var(--accent-amber,#d97706)]'
        : 'border-[color:color-mix(in_oklab,var(--ink)_22%,transparent)] text-[color:var(--text-dim)]';
  return (
    <span
      className={
        'inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] ' +
        tone
      }
    >
      {mode}
    </span>
  );
}
