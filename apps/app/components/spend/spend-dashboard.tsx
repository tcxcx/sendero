/**
 * SpendDashboard — design-canvas Spend layout.
 *
 *   Crumb · header (h1 + lede + W/M/Y range pills) · 4-KPI strip
 *   (Total / Calls / Avg cost / Cap utilization) · "Spend over time"
 *   card with inline SVG sparkline · "By tool" card (bars + top-tools
 *   list) · Caps + Recent batches sub-cards.
 *
 * Range pills are real: each is a `<Link>` to `?range=W|M|Y`.  The
 * server resolves that to a 7d/30d/365d window and re-fetches the
 * `tenantSpendSummary`.  Cap utilization is computed from the real
 * `tenantSpendCap` rows: weekly = 7×daily, monthly = monthly,
 * yearly = 12×monthly.
 */

import Link from 'next/link';

import { Crumb } from '@/components/console/crumb';
import { formatDateTime, formatMicroUsd } from '@/lib/format';

type SpendSummary = {
  totalMicro: bigint;
  totalCalls: number;
  perTool: Array<{ toolName: string; calls: number; micro: bigint }>;
  timeseries: Array<{ bucketStartedAt: Date; micro: bigint; calls: number }>;
};

type CapRow = {
  period: string;
  amountMicroUsdc: bigint;
  hardCap: boolean;
};

type BatchRow = {
  id: string;
  status: string;
  totalMicroUsdc: bigint;
  eventCount: number;
  txHash: string | null;
  settledAt: Date | null;
  createdAt: Date;
};

export type SpendRange = 'W' | 'M' | 'Y';

const RANGE_LABEL: Record<SpendRange, string> = {
  W: 'Week',
  M: 'Month',
  Y: 'Year',
};

const RANGE_DAYS: Record<SpendRange, number> = {
  W: 7,
  M: 30,
  Y: 365,
};

const RANGE_LEDE: Record<SpendRange, string> = {
  W: '7-day trailing',
  M: '30-day trailing',
  Y: 'TTM · trailing twelve months',
};

export function SpendDashboard({
  tenantName,
  tier,
  range,
  summary,
  caps,
  recentBatches,
}: {
  tenantName: string;
  tier: string;
  range: SpendRange;
  summary: SpendSummary;
  caps: CapRow[];
  recentBatches: BatchRow[];
}) {
  const avgMicro = summary.totalCalls > 0 ? summary.totalMicro / BigInt(summary.totalCalls) : 0n;
  const capCeilingMicro = capCeilingForRange(range, caps);
  const utilizationPct =
    capCeilingMicro && capCeilingMicro > 0n
      ? Math.min(999, Math.round((Number(summary.totalMicro) / Number(capCeilingMicro)) * 100))
      : null;

  const tooltipsRange = `${RANGE_LABEL[range]} · ${RANGE_LEDE[range]}`;

  return (
    <div
      style={{
        padding: '24px 28px',
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
        flex: 1,
        minHeight: 0,
      }}
    >
      <Crumb trail={['Money & policy', 'Spend']} />

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          gap: 24,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h1 className="t-h1">Spend</h1>
          <p className="t-body-lg ink-70" style={{ marginTop: 6, maxWidth: '60ch' }}>
            {tooltipsRange} · {summary.totalCalls.toLocaleString()} paid call
            {summary.totalCalls === 1 ? '' : 's'} across {summary.perTool.length} tool
            {summary.perTool.length === 1 ? '' : 's'} · {tenantName} · {tier}
          </p>
        </div>
        <RangePills active={range} />
      </div>

      <KpiStrip
        items={[
          {
            label: 'Total',
            value: formatMicroUsd(summary.totalMicro),
            sub: tooltipsRange,
          },
          {
            label: 'Calls',
            value: summary.totalCalls.toLocaleString(),
            sub: `paid meter events`,
          },
          {
            label: 'Avg cost',
            value: summary.totalCalls === 0 ? '—' : formatMicroUsd(avgMicro),
            sub: 'per call',
          },
          {
            label: 'Cap utilization',
            value: utilizationPct === null ? '—' : `${utilizationPct}%`,
            sub:
              capCeilingMicro && capCeilingMicro > 0n
                ? `of ${formatMicroUsd(capCeilingMicro)} ${RANGE_LABEL[range].toLowerCase()} ceiling`
                : 'no cap configured',
          },
        ]}
      />

      <div
        className="sd-card-raised"
        style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div className="t-h3">Spend over time</div>
          <div className="t-mono ink-60" style={{ fontSize: 11 }}>
            USD · paid only
          </div>
        </div>
        {summary.timeseries.length === 0 ? (
          <SpendEmpty range={range} />
        ) : (
          <Sparkline points={summary.timeseries} />
        )}
      </div>

      <div
        className="sd-card-raised"
        style={{
          padding: '20px 24px',
          display: 'grid',
          gridTemplateColumns: '1.4fr 1fr',
          gap: 24,
          flex: 1,
          minHeight: 280,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div className="t-h3">By tool</div>
            <span className="t-mono ink-60" style={{ fontSize: 11 }}>
              {summary.perTool.length} tool{summary.perTool.length === 1 ? '' : 's'}
            </span>
          </div>
          {summary.perTool.length === 0 ? (
            <div className="t-body ink-60" style={{ fontSize: 13 }}>
              No tool calls in this window.
            </div>
          ) : (
            <ToolBars perTool={summary.perTool} />
          )}
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            borderLeft: '1px solid var(--hairline-color-soft)',
            paddingLeft: 24,
            minWidth: 0,
          }}
        >
          <div className="t-meta">Top tools</div>
          {topTools(summary).length === 0 ? (
            <div className="t-body ink-60" style={{ fontSize: 13, marginTop: 6 }}>
              —
            </div>
          ) : (
            topTools(summary).map((row, i, arr) => {
              const sharePct =
                summary.totalMicro === 0n
                  ? 0
                  : Math.round((Number(row.micro) / Number(summary.totalMicro)) * 100);
              return (
                <div
                  key={row.toolName}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    padding: '8px 0',
                    borderBottom:
                      i < arr.length - 1 ? '1px solid var(--hairline-color-soft)' : 'none',
                    gap: 12,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div
                      className="t-body"
                      style={{
                        fontWeight: 500,
                        fontSize: 13,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {row.toolName}
                    </div>
                    <div className="t-mono ink-60" style={{ fontSize: 11, marginTop: 2 }}>
                      {row.calls} call{row.calls === 1 ? '' : 's'}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div
                      className="t-num-md"
                      style={{ fontSize: 16, fontVariantNumeric: 'tabular-nums' }}
                    >
                      {formatMicroUsd(row.micro)}
                    </div>
                    <div className="t-mono ink-60" style={{ fontSize: 11 }}>
                      {sharePct}%
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 18,
        }}
      >
        <div
          className="sd-card-flat"
          style={{ boxShadow: 'inset 0 0 0 1px var(--hairline-color)', padding: '14px 16px' }}
        >
          <div className="t-meta">Caps</div>
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column' }}>
            {caps.length === 0 ? (
              <div className="t-body ink-60" style={{ fontSize: 13 }}>
                No caps configured.
              </div>
            ) : (
              caps.map((cap, i) => (
                <div
                  key={`${cap.period}-${i}`}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    padding: '8px 0',
                    borderBottom:
                      i < caps.length - 1 ? '1px solid var(--hairline-color-soft)' : 'none',
                  }}
                >
                  <span className="t-body" style={{ fontSize: 13, textTransform: 'capitalize' }}>
                    {cap.period}
                  </span>
                  <span
                    className="t-mono"
                    style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}
                  >
                    {formatMicroUsd(cap.amountMicroUsdc)} · {cap.hardCap ? 'hard' : 'soft'}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        <div
          className="sd-card-flat"
          style={{ boxShadow: 'inset 0 0 0 1px var(--hairline-color)', padding: '14px 16px' }}
        >
          <div className="t-meta">Recent batches</div>
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column' }}>
            {recentBatches.length === 0 ? (
              <div className="t-body ink-60" style={{ fontSize: 13 }}>
                No batches yet.
              </div>
            ) : (
              recentBatches.map((b, i) => (
                <div
                  key={b.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 0',
                    borderBottom:
                      i < recentBatches.length - 1
                        ? '1px solid var(--hairline-color-soft)'
                        : 'none',
                    gap: 8,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div className="t-mono" style={{ fontSize: 12 }}>
                      {b.id.slice(0, 10)}
                    </div>
                    <div className="t-mono ink-60" style={{ fontSize: 11, marginTop: 2 }}>
                      {formatDateTime(b.settledAt ?? b.createdAt)}
                    </div>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      flexShrink: 0,
                    }}
                  >
                    <BatchStatusPill status={b.status} />
                    <span
                      className="t-mono"
                      style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}
                    >
                      {formatMicroUsd(b.totalMicroUsdc)}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── range pills ──────────────────────────────────────────────

function RangePills({ active }: { active: SpendRange }) {
  const ranges: SpendRange[] = ['W', 'M', 'Y'];
  return (
    <div
      style={{
        display: 'flex',
        gap: 4,
        padding: 4,
        background: 'var(--surface-base)',
        borderRadius: 10,
        boxShadow: 'inset 0 0 0 1px var(--hairline-color)',
      }}
    >
      {ranges.map(r => {
        const isActive = active === r;
        return (
          <Link
            key={r}
            href={`/dashboard/spend?range=${r}`}
            style={{
              background: isActive ? 'var(--midnight)' : 'transparent',
              color: isActive ? 'var(--surface-floating)' : 'rgba(31,42,68,0.7)',
              padding: '6px 14px',
              borderRadius: 8,
              fontFamily: 'var(--font-sans)',
              fontSize: 12,
              fontWeight: 500,
              textDecoration: 'none',
              minWidth: 56,
              textAlign: 'center',
            }}
          >
            {RANGE_LABEL[r]}
          </Link>
        );
      })}
    </div>
  );
}

// ── KPI strip ────────────────────────────────────────────────

function KpiStrip({ items }: { items: Array<{ label: string; value: string; sub: string }> }) {
  return (
    <div
      className="sd-card-flat"
      style={{
        boxShadow: 'inset 0 0 0 1px var(--hairline-color)',
        padding: '4px 0',
        display: 'flex',
        alignItems: 'stretch',
      }}
    >
      {items.map((k, i) => (
        <div
          key={k.label}
          style={{
            flex: 1,
            padding: '14px 24px 16px',
            borderRight: i < items.length - 1 ? '1px solid var(--hairline-color)' : 'none',
            minWidth: 0,
          }}
        >
          <div className="t-meta">{k.label}</div>
          <div
            className="t-num-lg"
            style={{
              fontSize: 32,
              marginTop: 6,
              lineHeight: 1,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {k.value}
          </div>
          <div className="t-mono ink-60" style={{ fontSize: 11, marginTop: 6 }}>
            {k.sub}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── inline charts ────────────────────────────────────────────

function Sparkline({ points }: { points: SpendSummary['timeseries'] }) {
  const w = 1180;
  const h = 140;
  const pad = 8;
  const values = points.map(p => Number(p.micro));
  const max = Math.max(1, ...values);
  const xs = points.map((_, i) =>
    points.length === 1 ? w / 2 : pad + (i / (points.length - 1)) * (w - pad * 2)
  );
  const ys = values.map(v => h - pad - (v / max) * (h - pad * 2));
  const path = xs
    .map((x, i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${ys[i].toFixed(1)}`)
    .join(' ');
  const area = `${path} L${xs[xs.length - 1].toFixed(1)},${h - pad} L${xs[0].toFixed(1)},${h - pad} Z`;
  const labels = pickAxisLabels(points);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height: 140, display: 'block' }}
      >
        <defs>
          <linearGradient id="spend-spark-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--vermillion)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--vermillion)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#spend-spark-fill)" />
        <path d={path} fill="none" stroke="var(--vermillion)" strokeWidth="2" />
        {xs.map((x, i) => (
          <circle key={i} cx={x} cy={ys[i]} r={2.5} fill="var(--vermillion)" />
        ))}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        {labels.map((label, i) => (
          <span key={i} className="t-mono ink-60" style={{ fontSize: 10.5 }}>
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

function ToolBars({ perTool }: { perTool: SpendSummary['perTool'] }) {
  const top = [...perTool].sort((a, b) => Number(b.micro - a.micro)).slice(0, 10);
  const max = top.reduce((acc, r) => (r.micro > acc ? r.micro : acc), 0n);
  const w = 680;
  const h = 150;
  const gap = 6;
  const colW = (w - gap * (top.length - 1)) / Math.max(top.length, 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height: 150, display: 'block' }}
      >
        {top.map((row, i) => {
          const x = i * (colW + gap);
          const ratio = max === 0n ? 0 : Number(row.micro) / Number(max);
          const barH = Math.max(2, ratio * (h - 8));
          const y = h - barH;
          const isAccent = i === 0;
          return (
            <rect
              key={row.toolName}
              x={x}
              y={y}
              width={colW}
              height={barH}
              rx={2}
              fill={isAccent ? 'var(--vermillion)' : 'var(--midnight)'}
              opacity={isAccent ? 1 : 0.75}
            />
          );
        })}
      </svg>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${Math.max(top.length, 1)}, 1fr)`,
          gap: 4,
          height: 36,
        }}
      >
        {top.map(row => (
          <div
            key={row.toolName}
            className="t-mono ink-60"
            style={{
              fontSize: 9.5,
              transform: 'rotate(-30deg)',
              transformOrigin: 'top left',
              whiteSpace: 'nowrap',
              paddingLeft: 4,
            }}
          >
            {row.toolName}
          </div>
        ))}
      </div>
    </div>
  );
}

function SpendEmpty({ range }: { range: SpendRange }) {
  return (
    <div
      style={{
        padding: '36px 24px',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        alignItems: 'center',
      }}
    >
      <div
        aria-hidden
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          background: 'var(--tint-vermillion-soft)',
          color: 'var(--vermillion)',
          display: 'grid',
          placeItems: 'center',
          fontSize: 20,
        }}
      >
        ⌁
      </div>
      <div className="t-h3">No paid meter events yet</div>
      <div className="t-body ink-70" style={{ fontSize: 13, maxWidth: '52ch', lineHeight: 1.55 }}>
        Tools you call from <code className="t-mono">/api/agent/dispatch</code> or the MCP server
        write a metered event for this tenant. Once the first call lands inside the{' '}
        {RANGE_LABEL[range].toLowerCase()} window, the chart fills in automatically — no manual
        ingest, no daily cron.
      </div>
    </div>
  );
}

function BatchStatusPill({ status }: { status: string }) {
  const tone =
    status === 'settled'
      ? 'sea'
      : status === 'pending'
        ? 'sand'
        : status === 'failed'
          ? 'verm'
          : 'outline';
  return (
    <span
      className={`sd-pill sd-pill-${tone}`}
      style={{ fontSize: 9, padding: '2px 7px', fontWeight: 700 }}
    >
      {status.toUpperCase()}
    </span>
  );
}

// ── helpers ─────────────────────────────────────────────────

function topTools(summary: SpendSummary): SpendSummary['perTool'] {
  return [...summary.perTool].sort((a, b) => Number(b.micro - a.micro)).slice(0, 5);
}

function capCeilingForRange(range: SpendRange, caps: CapRow[]): bigint | null {
  const daily = caps.find(c => c.period === 'daily');
  const monthly = caps.find(c => c.period === 'monthly');
  if (range === 'W') {
    if (daily) return daily.amountMicroUsdc * 7n;
    if (monthly) return (monthly.amountMicroUsdc * 7n) / 30n;
    return null;
  }
  if (range === 'M') {
    if (monthly) return monthly.amountMicroUsdc;
    if (daily) return daily.amountMicroUsdc * 30n;
    return null;
  }
  if (monthly) return monthly.amountMicroUsdc * 12n;
  if (daily) return daily.amountMicroUsdc * 365n;
  return null;
}

function pickAxisLabels(points: SpendSummary['timeseries']): string[] {
  if (points.length === 0) return [];
  if (points.length <= 6) {
    return points.map(p =>
      p.bucketStartedAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    );
  }
  const ticks = 6;
  return Array.from({ length: ticks }, (_, i) => {
    const idx = Math.round((i / (ticks - 1)) * (points.length - 1));
    return points[idx].bucketStartedAt.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  });
}
