import { prisma } from '@sendero/database';

/**
 * Ops-console channel panel — aggregates cross-tenant channel health
 * for platform admins (internal Sendero operators). Surfaces:
 *   - total active vs pending vs error installs
 *   - last-24h webhook volume per channel (coarse — from
 *     ChannelIdentity updates)
 *   - onboarding funnel counts (pending setup links vs activated)
 *
 * Renders as a server component; consuming page is responsible for
 * auth gating to the ops role.
 */
export async function ChannelsOpsPanel() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [waByStatus, slackCount, waActivityCount, slackActivityCount] = await Promise.all([
    prisma.whatsAppInstall.groupBy({
      by: ['status'],
      _count: true,
    }),
    prisma.slackInstall.count(),
    prisma.channelIdentity.count({
      where: { kind: 'whatsapp', updatedAt: { gte: since } },
    }),
    prisma.channelIdentity.count({
      where: { kind: 'slack', updatedAt: { gte: since } },
    }),
  ]);

  const waMap = new Map(waByStatus.map(row => [row.status, row._count]));
  const waActive = waMap.get('active') ?? 0;
  const waPending = waMap.get('pending') ?? 0;
  const waError = waMap.get('error') ?? 0;

  return (
    <section className="rounded-[var(--radius-lg)] bg-[color:var(--surface-raised)] p-6 shadow-[var(--shadow-md)]">
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-1">
          <h3 className="text-[15px] font-semibold tracking-normal text-foreground">Channel ops</h3>
          <p className="text-xs text-muted-foreground">
            WhatsApp installs via Kapso + Slack installs. Last-24h activity is a coarse proxy
            (ChannelIdentity updates).
          </p>
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
        <Stat label="WA active" value={waActive} tone="good" />
        <Stat label="WA pending" value={waPending} tone="warn" />
        <Stat label="WA error" value={waError} tone={waError > 0 ? 'bad' : 'neutral'} />
        <Stat label="Slack installs" value={slackCount} tone="neutral" />
        <Stat label="WA activity 24h" value={waActivityCount} tone="neutral" />
        <Stat label="Slack activity 24h" value={slackActivityCount} tone="neutral" />
      </dl>
    </section>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'good' | 'warn' | 'bad' | 'neutral';
}) {
  const tint =
    tone === 'good'
      ? 'var(--tint-sea-soft)'
      : tone === 'warn'
        ? 'var(--tint-sand-soft)'
        : tone === 'bad'
          ? 'var(--tint-vermillion-soft)'
          : 'var(--surface-floating)';
  return (
    <div className="rounded-[var(--radius-md)] p-3" style={{ backgroundColor: tint }}>
      <dt
        className="font-mono uppercase text-muted-foreground"
        style={{
          fontSize: 'var(--label-meta, 0.6875rem)',
          letterSpacing: 'var(--label-meta-tracking, 0.12em)',
        }}
      >
        {label}
      </dt>
      <dd
        className="mt-1 text-lg font-semibold text-foreground"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {value}
      </dd>
    </div>
  );
}
