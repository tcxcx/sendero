/**
 * Rich connected-status panel for the WhatsApp channel page. Shown
 * when WhatsAppInstall.status === 'active'. Reads:
 *   - Display name + display number from WhatsAppInstall
 *   - Brand profile (about, photo, greeting) from metadata.profile
 *   - Templates from metadata.templates
 *   - Recent conversations + this-week stats from ChannelIdentity / Trip
 *
 * The metric strip + recent-conversations layout matches the design
 * in the channels:WhatsApp wireframe.
 */

import Link from 'next/link';

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
}

const PILL =
  'inline-flex items-center rounded-full border border-[color:color-mix(in_oklab,var(--ink)_22%,transparent)] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-[color:var(--text-dim)]';
const TITLE_PILL =
  'font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--text-faint)]';

export function WhatsappConnectedPanel({
  displayName,
  displayPhoneNumber,
  status,
  templates,
  recentThreads,
  weeklyStats,
}: WhatsappConnectedProps) {
  return (
    <section className="flex flex-col gap-5 overflow-hidden rounded-[var(--radius-lg)] border border-[color:color-mix(in_oklab,var(--accent-rose)_45%,transparent)] bg-[color:var(--surface-raised)] p-6 shadow-[var(--shadow-md)]">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className={TITLE_PILL}>Channels · WhatsApp</span>
          <h2 className="font-serif text-[clamp(36px,4vw,48px)] leading-[1] tracking-[-0.01em] text-[color:var(--ink)]">
            WhatsApp
          </h2>
          <p className="text-sm text-[color:var(--text-dim)]">
            Connected via Kapso · {recentThreads.length} active threads · {weeklyStats.trips} trips
            this week
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded-md border border-[color:color-mix(in_oklab,var(--ink)_22%,transparent)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-[color:var(--text)] transition-colors hover:border-[color:var(--ink)] hover:text-[color:var(--ink)]"
          >
            Disconnect
          </button>
          <Link
            href="/dashboard/channels/whatsapp/connect"
            className="rounded-md bg-[color:var(--accent-rose)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-white transition-opacity hover:opacity-90"
          >
            Open settings
          </Link>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <MetricCard label="Status" value={status} pill="LIVE" tone="ok" />
        <MetricCard label="Number" value={displayPhoneNumber ?? '—'} pill="SET" mono />
        <MetricCard label="Display name" value={displayName ?? '—'} pill="SET" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.6fr_1fr]">
        <article className="flex flex-col gap-3 rounded-md border border-[color:color-mix(in_oklab,var(--ink)_10%,transparent)] bg-[color:var(--surface)] p-4">
          <header className="flex items-baseline justify-between">
            <h3 className="text-[14px] font-semibold text-[color:var(--ink)]">
              Recent conversations
            </h3>
            <span className={TITLE_PILL}>last 24h</span>
          </header>
          <ul className="flex flex-col divide-y divide-[color:color-mix(in_oklab,var(--ink)_8%,transparent)]">
            {recentThreads.length === 0 ? (
              <li className="py-4 text-sm text-[color:var(--text-dim)]">
                No threads yet. Travelers&rsquo; first messages will appear here.
              </li>
            ) : (
              recentThreads.map(t => (
                <li key={`${t.name}:${t.timeAgo}`} className="flex items-center gap-3 py-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[color:color-mix(in_oklab,var(--ink)_8%,transparent)] font-mono text-[11px] text-[color:var(--ink)]">
                    {t.initial}
                  </span>
                  <div className="flex flex-1 flex-col gap-0">
                    <span className="text-[13px] font-medium text-[color:var(--ink)]">
                      {t.name}
                    </span>
                    <span className="text-[12px] text-[color:var(--text-dim)]">{t.snippet}</span>
                  </div>
                  {t.badge ? (
                    <span className="inline-flex items-center rounded-full bg-[color:var(--accent-rose)] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-white">
                      {t.badge}
                    </span>
                  ) : null}
                  <span className="font-mono text-[11px] text-[color:var(--text-dim)]">
                    {t.timeAgo}
                  </span>
                </li>
              ))
            )}
          </ul>
        </article>

        <div className="flex flex-col gap-3">
          <article className="flex flex-col gap-2 rounded-md border border-[color:color-mix(in_oklab,var(--ink)_10%,transparent)] bg-[color:var(--surface)] p-4">
            <header className="flex items-baseline justify-between">
              <h3 className="text-[14px] font-semibold text-[color:var(--ink)]">Templates</h3>
            </header>
            <ul className="flex flex-col gap-1">
              {templates.length === 0 ? (
                <li className="text-[12px] text-[color:var(--text-dim)]">
                  No templates submitted.
                </li>
              ) : (
                templates.map(t => (
                  <li key={t.name} className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[12px] text-[color:var(--ink)]">{t.name}</span>
                    <span className={PILL}>{t.status}</span>
                  </li>
                ))
              )}
            </ul>
          </article>

          <article className="grid grid-cols-3 gap-3 rounded-md border border-[color:color-mix(in_oklab,var(--ink)_10%,transparent)] bg-[color:var(--surface)] p-4">
            <Stat label="Trips" value={weeklyStats.trips} />
            <Stat label="Messages" value={weeklyStats.messages} />
            <Stat label="Delivery" value={`${weeklyStats.deliveryRate}%`} />
          </article>
        </div>
      </div>
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
            ? 'font-mono text-[18px] tracking-tight text-[color:var(--ink)]'
            : 'font-serif text-[20px] leading-tight text-[color:var(--ink)]'
        }
      >
        {value}
      </span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex flex-col items-start">
      <span className="font-serif text-[clamp(22px,2.4vw,28px)] leading-tight text-[color:var(--ink)]">
        {value}
      </span>
      <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-[color:var(--text-dim)]">
        {label}
      </span>
    </div>
  );
}
