/**
 * /dashboard/finance/gmv — tenant GMV dashboard.
 *
 * Server Component. Reads `Booking.markupMicroUsdc` aggregates per
 * tenant for the current period (default last 30 days):
 *
 *   - 4 stat cards: total GMV, booking count, average margin, Sendero take YTD.
 *   - Daily GMV sparkline (CSS-only — no recharts in the repo yet).
 *   - Two side-by-side tables: GMV by kind, top 10 agents by markup.
 *
 * Earliest-date guard (Eng A10): we EXCLUDE rows whose
 * `metadata.markupSource === 'pre_v1_no_markup_recorded'`. If that
 * leaves nothing in the period, we render the "GMV reporting begins …"
 * empty state. The earliest tracked booking date powers the timestamp.
 *
 * Index used: `Booking @@index([tenantId, kind, createdAt])` from the
 * markup-v1 migration. The `metadata` JSON filter is post-fetch in
 * Prisma — Postgres won't use the kind index for a `metadata.path`
 * filter, but the (tenantId, createdAt) index is enough for v1.
 */

import { prisma } from '@sendero/database';
import type { Prisma } from '@sendero/database';

import { requireRole } from '@/lib/require-role';
import { requireCurrentTenant } from '@/lib/tenant-context';

export const dynamic = 'force-dynamic';

const ALL_KINDS = ['flight', 'hotel', 'rail', 'car', 'other'] as const;
type Kind = (typeof ALL_KINDS)[number];

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PERIOD_DAYS = 30;

interface PageProps {
  searchParams: Promise<{ days?: string }>;
}

export default async function GmvPage({ searchParams }: PageProps) {
  await requireRole('org:admin');
  const { tenant } = await requireCurrentTenant();
  const sp = await searchParams;
  const days = parsePeriodDays(sp.days);
  const since = new Date(Date.now() - days * DAY_MS);
  const startOfYear = new Date(new Date().getFullYear(), 0, 1);

  // Pre-v1 rows have no markupSource in metadata so we filter them
  // OUT in JS after fetch. The where-clause uses the tenantId+createdAt
  // index; the JSON filter is the post-fetch step.
  const periodRows = await prisma.booking.findMany({
    where: {
      tenantId: tenant.id,
      createdAt: { gte: since },
      markupMicroUsdc: { not: null },
    },
    select: {
      id: true,
      kind: true,
      createdAt: true,
      markupMicroUsdc: true,
      senderoTakeMicroUsdc: true,
      costMicroUsdc: true,
      metadata: true,
      createdBy: { select: { id: true, displayName: true, email: true } },
    },
    take: 5_000,
    orderBy: { createdAt: 'desc' },
  });

  const tracked = periodRows.filter(r => !isPreV1(r.metadata));

  // Detect "pre-launch" tenant: nothing in the period has tracked
  // markup. Surface the launch-date empty state.
  if (tracked.length === 0) {
    const earliestTracked = await prisma.booking.findFirst({
      where: {
        tenantId: tenant.id,
        markupMicroUsdc: { not: null },
        NOT: { metadata: { path: ['markupSource'], equals: 'pre_v1_no_markup_recorded' } },
      },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });
    return <EmptyGmv launchDate={earliestTracked?.createdAt ?? null} />;
  }

  // ── Aggregates ──
  const totalGmv = sum(tracked, r => r.markupMicroUsdc ?? 0n);
  const totalCost = sum(tracked, r => r.costMicroUsdc ?? 0n);
  const bookingCount = tracked.length;
  const avgMarginPct = totalCost > 0n ? Number((totalGmv * 10_000n) / totalCost) / 100 : 0;

  // YTD Sendero take (separate query — needs a different time window).
  const ytdAgg = await prisma.booking.aggregate({
    where: {
      tenantId: tenant.id,
      createdAt: { gte: startOfYear },
      senderoTakeMicroUsdc: { not: null },
    },
    _sum: { senderoTakeMicroUsdc: true },
  });
  const ytdTake = ytdAgg._sum.senderoTakeMicroUsdc ?? 0n;

  // Daily series for the sparkline.
  const dailyByDay = new Map<string, bigint>();
  for (const r of tracked) {
    const key = ymd(r.createdAt);
    dailyByDay.set(key, (dailyByDay.get(key) ?? 0n) + (r.markupMicroUsdc ?? 0n));
  }
  const dailySeries = buildDailySeries(since, days, dailyByDay);

  // GMV by kind.
  const byKind = new Map<Kind, { gmv: bigint; count: number }>();
  for (const r of tracked) {
    if (!isKind(r.kind)) continue;
    const cur = byKind.get(r.kind) ?? { gmv: 0n, count: 0 };
    cur.gmv += r.markupMicroUsdc ?? 0n;
    cur.count += 1;
    byKind.set(r.kind, cur);
  }
  const kindRows = ALL_KINDS.map(k => ({
    kind: k,
    gmv: byKind.get(k)?.gmv ?? 0n,
    count: byKind.get(k)?.count ?? 0,
  })).sort((a, b) => Number(b.gmv - a.gmv));

  // Top 10 agents.
  const byAgent = new Map<string, { name: string; gmv: bigint; count: number }>();
  for (const r of tracked) {
    const id = r.createdBy?.id ?? 'unknown';
    const name = r.createdBy?.displayName ?? r.createdBy?.email ?? 'Unknown';
    const cur = byAgent.get(id) ?? { name, gmv: 0n, count: 0 };
    cur.gmv += r.markupMicroUsdc ?? 0n;
    cur.count += 1;
    byAgent.set(id, cur);
  }
  const agentRows = Array.from(byAgent.values())
    .sort((a, b) => Number(b.gmv - a.gmv))
    .slice(0, 10);

  return (
    <div
      style={{
        padding: '0 20px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
        flex: 1,
        minHeight: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 24,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h1 className="t-h1">GMV</h1>
          <p className="t-body-lg ink-70" style={{ marginTop: 6, maxWidth: '60ch' }}>
            Your gross margin (markup × volume) over the last {days} days. Sendero&apos;s take is
            shown alongside YTD; both come from the markup snapshots pinned at confirm time.
          </p>
        </div>
        <PeriodSelector active={days} />
      </div>

      {/* Stat cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 14,
        }}
      >
        <StatCard
          label="Total GMV"
          value={fmtUsdc(totalGmv)}
          sublabel={`${days}d window`}
          tone="midnight"
        />
        <StatCard
          label="Bookings"
          value={bookingCount.toLocaleString()}
          sublabel={`${days}d window`}
          tone="midnight"
        />
        <StatCard
          label="Avg margin"
          value={`${avgMarginPct.toFixed(1)}%`}
          sublabel="markup ÷ cost"
          tone="sea"
        />
        <StatCard
          label="Sendero take YTD"
          value={fmtUsdc(ytdTake)}
          sublabel="this calendar year"
          tone="midnight"
        />
      </div>

      {/* Sparkline */}
      <div className="sd-card-flat" style={cardStyle}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            marginBottom: 10,
          }}
        >
          <span className="t-meta">DAILY GMV</span>
          <span className="t-mono ink-60" style={{ fontSize: 11 }}>
            peak {fmtUsdc(dailySeries.reduce((m, d) => (d.value > m ? d.value : m), 0n))}
          </span>
        </div>
        <Sparkline series={dailySeries} />
      </div>

      {/* Two tables side-by-side >=1024px */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 18,
        }}
      >
        <KindTable rows={kindRows} totalGmv={totalGmv} />
        <AgentTable rows={agentRows} totalGmv={totalGmv} />
      </div>
    </div>
  );
}

// ─── Subcomponents ───────────────────────────────────────────────────

function PeriodSelector({ active }: { active: number }) {
  const opts = [7, 30, 90];
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {opts.map(d => {
        const isOn = d === active;
        return (
          <a
            key={d}
            href={`?days=${d}`}
            className="t-mono"
            style={{
              padding: '6px 12px',
              borderRadius: 999,
              fontSize: 11,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              textDecoration: 'none',
              background: isOn ? 'var(--vermillion)' : 'var(--surface-floating)',
              color: isOn ? '#fdfbf7' : 'var(--midnight)',
              boxShadow: isOn ? 'none' : 'inset 0 0 0 1px var(--hairline-color)',
            }}
          >
            {d}d
          </a>
        );
      })}
    </div>
  );
}

function StatCard({
  label,
  value,
  sublabel,
  tone,
}: {
  label: string;
  value: string;
  sublabel: string;
  tone: 'midnight' | 'sea';
}) {
  return (
    <div className="sd-card-flat" style={cardStyle}>
      <div className="t-meta" style={{ marginBottom: 6 }}>
        {label.toUpperCase()}
      </div>
      <div
        className="t-num-md"
        style={{
          fontSize: 28,
          fontWeight: 600,
          color: tone === 'sea' ? 'var(--sea)' : 'var(--midnight)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </div>
      <div className="t-mono ink-60" style={{ fontSize: 10, marginTop: 4 }}>
        {sublabel}
      </div>
    </div>
  );
}

function Sparkline({ series }: { series: { date: string; value: bigint }[] }) {
  const max = series.reduce((m, d) => (d.value > m ? d.value : m), 0n);
  // Render as bars to avoid pulling in a charting lib. Heights map
  // proportionally to `max` so the visual reads relative magnitude.
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 96 }}>
      {series.map(d => {
        const pct = max > 0n ? Number((d.value * 100n) / max) : 0;
        return (
          <div
            key={d.date}
            title={`${d.date}: ${fmtUsdc(d.value)}`}
            style={{
              flex: 1,
              height: `${Math.max(2, pct)}%`,
              background: d.value > 0n ? 'var(--sea)' : 'var(--hairline-color-soft)',
              borderRadius: 2,
              transition: 'height 200ms ease',
            }}
          />
        );
      })}
    </div>
  );
}

function KindTable({
  rows,
  totalGmv,
}: {
  rows: { kind: Kind; gmv: bigint; count: number }[];
  totalGmv: bigint;
}) {
  return (
    <div className="sd-card-flat" style={{ ...cardStyle, padding: 0, overflow: 'hidden' }}>
      <div
        style={{
          padding: '14px 18px',
          borderBottom: '1px solid var(--hairline-color)',
          display: 'grid',
          gridTemplateColumns: '1.4fr 1fr 1fr 0.6fr',
        }}
      >
        {['Category', 'GMV', 'Share', 'Count'].map(h => (
          <div key={h} className="t-meta">
            {h}
          </div>
        ))}
      </div>
      {rows.map((r, i) => {
        const sharePct = totalGmv > 0n ? Number((r.gmv * 1000n) / totalGmv) / 10 : 0;
        return (
          <div
            key={r.kind}
            style={{
              padding: '12px 18px',
              borderBottom: i < rows.length - 1 ? '1px solid var(--hairline-color-soft)' : 'none',
              display: 'grid',
              gridTemplateColumns: '1.4fr 1fr 1fr 0.6fr',
              alignItems: 'center',
            }}
          >
            <div className="t-body" style={{ fontSize: 13, textTransform: 'capitalize' }}>
              {r.kind}
            </div>
            <div className="t-mono" style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
              {fmtUsdc(r.gmv)}
            </div>
            <div className="t-mono ink-70" style={{ fontSize: 11 }}>
              {sharePct.toFixed(1)}%
            </div>
            <div className="t-mono ink-70" style={{ fontSize: 12 }}>
              {r.count}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AgentTable({
  rows,
  totalGmv,
}: {
  rows: { name: string; gmv: bigint; count: number }[];
  totalGmv: bigint;
}) {
  if (rows.length === 0) {
    return (
      <div className="sd-card-flat" style={cardStyle}>
        <div className="t-meta" style={{ marginBottom: 6 }}>
          TOP AGENTS
        </div>
        <p className="t-body ink-70" style={{ fontSize: 13 }}>
          No agent attribution yet. Bookings created via API key are scoped to the org admin.
        </p>
      </div>
    );
  }
  return (
    <div className="sd-card-flat" style={{ ...cardStyle, padding: 0, overflow: 'hidden' }}>
      <div
        style={{
          padding: '14px 18px',
          borderBottom: '1px solid var(--hairline-color)',
          display: 'grid',
          gridTemplateColumns: '1.4fr 1fr 0.6fr',
        }}
      >
        {['Agent', 'GMV', 'Bookings'].map(h => (
          <div key={h} className="t-meta">
            {h}
          </div>
        ))}
      </div>
      {rows.map((r, i) => {
        const sharePct = totalGmv > 0n ? Number((r.gmv * 1000n) / totalGmv) / 10 : 0;
        return (
          <div
            key={r.name + i}
            style={{
              padding: '12px 18px',
              borderBottom: i < rows.length - 1 ? '1px solid var(--hairline-color-soft)' : 'none',
              display: 'grid',
              gridTemplateColumns: '1.4fr 1fr 0.6fr',
              alignItems: 'center',
            }}
          >
            <div className="t-body" style={{ fontSize: 13 }}>
              {r.name}
              <span className="t-mono ink-60" style={{ fontSize: 10, marginLeft: 8 }}>
                {sharePct.toFixed(1)}%
              </span>
            </div>
            <div className="t-mono" style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
              {fmtUsdc(r.gmv)}
            </div>
            <div className="t-mono ink-70" style={{ fontSize: 12 }}>
              {r.count}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EmptyGmv({ launchDate }: { launchDate: Date | null }) {
  const dateStr = launchDate ? launchDate.toISOString().slice(0, 10) : 'soon';
  return (
    <div
      style={{
        padding: '0 20px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
        flex: 1,
        minHeight: 0,
      }}
    >
      <div>
        <h1 className="t-h1">GMV</h1>
      </div>
      <div
        className="sd-card-flat"
        style={{
          ...cardStyle,
          padding: '36px 24px',
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          alignItems: 'center',
        }}
      >
        <div className="t-h3">GMV reporting begins {dateStr}</div>
        <div className="t-body ink-70" style={{ fontSize: 13, maxWidth: '52ch', lineHeight: 1.55 }}>
          Bookings made before that date were sold cost-plus-only and don&apos;t carry a markup
          snapshot. Set a markup policy and confirm a booking to start populating this dashboard.
        </div>
        <a href="/dashboard/settings/pricing" style={primaryBtnStyle}>
          Set up markup
        </a>
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────

function parsePeriodDays(value: string | undefined): number {
  if (!value) return DEFAULT_PERIOD_DAYS;
  const n = Number(value);
  if (n === 7 || n === 30 || n === 90) return n;
  return DEFAULT_PERIOD_DAYS;
}

function isPreV1(metadata: Prisma.JsonValue | null): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false;
  const meta = metadata as Record<string, unknown>;
  return meta.markupSource === 'pre_v1_no_markup_recorded';
}

function isKind(value: unknown): value is Kind {
  return (
    value === 'flight' ||
    value === 'hotel' ||
    value === 'rail' ||
    value === 'car' ||
    value === 'other'
  );
}

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function buildDailySeries(
  since: Date,
  days: number,
  byDay: Map<string, bigint>
): { date: string; value: bigint }[] {
  const out: { date: string; value: bigint }[] = [];
  const start = new Date(since);
  start.setUTCHours(0, 0, 0, 0);
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getTime() + i * DAY_MS);
    const key = ymd(d);
    out.push({ date: key, value: byDay.get(key) ?? 0n });
  }
  return out;
}

function sum<T>(rows: T[], pick: (r: T) => bigint): bigint {
  let acc = 0n;
  for (const r of rows) acc += pick(r);
  return acc;
}

function fmtUsdc(micro: bigint): string {
  const negative = micro < 0n;
  const abs = negative ? -micro : micro;
  const whole = abs / 1_000_000n;
  const frac = abs % 1_000_000n;
  const fracStr = frac.toString().padStart(6, '0').slice(0, 2);
  const wholeFormatted = whole.toLocaleString('en-US');
  return `${negative ? '−' : ''}$${wholeFormatted}.${fracStr}`;
}

const cardStyle: React.CSSProperties = {
  padding: '18px 22px',
  boxShadow: 'inset 0 0 0 1px var(--hairline-color)',
  borderRadius: 12,
  background: 'var(--surface-floating)',
};

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

// ─── TODOs ───────────────────────────────────────────────────────────
// - Recharts: add when the team approves the dep. Until then, the
//   CSS bar sparkline reads relative magnitude well enough.
// - Recommendation cron (Track E4): write a `tenant_gmv_recommendation`
//   denormalized table so /settings/pricing can stop running the
//   inline aggregate. Schema TBD; current page tolerates `{}` returns.
// - Sidebar nav: `/dashboard/finance/gmv` isn't added to
//   `app-sidebar.tsx` yet. Drop it under the existing `Money & policy`
//   group when the rest of the finance hub lands (cancellations,
//   reconciliation, etc.) to avoid one-off nav noise.
// - Playwright sketch: seed two confirmed bookings via Prisma, hit
//   the page, assert the stat-card values + the kind table sums.
