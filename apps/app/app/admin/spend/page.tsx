/**
 * Admin dashboard v1 — tenant spend.
 *
 * Server-rendered. No client JS beyond what globals.css styles already
 * ship. Pulls from Prisma directly via @sendero/billing/analytics.
 * Query param: `?tenantId=<cuid>` or defaults to the env
 * WHATSAPP_DEFAULT_TENANT_ID so the hackathon demo works out of the box.
 */

import { formatMicroUsdc } from '@sendero/billing/pricing';
import { arcMarginFactor, tenantSpendSummary } from '@sendero/billing/analytics';
import { prisma } from '@sendero/database';
import { env } from '@sendero/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DAY_MS = 24 * 60 * 60 * 1000;

interface SpendPageProps {
  searchParams: Promise<{ tenantId?: string; days?: string }>;
}

export default async function SpendPage({ searchParams }: SpendPageProps) {
  const params = await searchParams;
  const tenantId = params.tenantId ?? env.whatsappDefaultTenantId() ?? null;
  const days = Math.min(Math.max(Number(params.days ?? 7), 1), 90);

  if (!tenantId) {
    return (
      <main style={rootStyle}>
        <h1 style={h1Style}>Sendero · spend</h1>
        <p style={noteStyle}>
          No tenant selected. Pass <code>?tenantId=&lt;cuid&gt;</code> or set{' '}
          <code>WHATSAPP_DEFAULT_TENANT_ID</code>.
        </p>
      </main>
    );
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { displayName: true, slug: true, billingTier: true },
  });

  const now = new Date();
  const from = new Date(now.getTime() - days * DAY_MS);

  const summary = await tenantSpendSummary(makeAnalyticsStore(), {
    tenantId,
    from,
    to: now,
    bucket: 'day',
  });

  const caps = await prisma.tenantSpendCap.findMany({
    where: { tenantId },
    select: {
      period: true,
      amountMicroUsdc: true,
      hardCap: true,
    },
  });

  const recentBatches = await prisma.nanopayBatch.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    take: 8,
    select: {
      id: true,
      status: true,
      totalMicroUsdc: true,
      eventCount: true,
      txHash: true,
      settledAt: true,
      createdAt: true,
    },
  });

  const margin = arcMarginFactor({
    actualMicroOnArc: summary.totalMicro,
    callCount: summary.totalCalls,
  });

  return (
    <main style={rootStyle}>
      <header style={headerStyle}>
        <div>
          <div style={eyebrowStyle}>tenant · {tenant?.slug ?? '—'}</div>
          <h1 style={h1Style}>{tenant?.displayName ?? 'Unknown tenant'}</h1>
        </div>
        <div style={badgeStyle}>{tenant?.billingTier ?? 'free'}</div>
      </header>

      <section style={gridStyle}>
        <Kpi label={`Spend · ${days}d`} value={`$${formatMicroUsdc(summary.totalMicro)}`} />
        <Kpi label={`Calls · ${days}d`} value={summary.totalCalls.toLocaleString()} />
        <Kpi
          label="Vs Ethereum"
          value={`${margin.toFixed(1)}×`}
          sub="cheaper on Arc"
          accent="#fb542b"
        />
        <Kpi
          label="Batches settled"
          value={recentBatches.filter(b => b.status === 'settled').length.toString()}
          sub={`${recentBatches.length} total`}
        />
      </section>

      <section style={sectionStyle}>
        <h2 style={h2Style}>Spend · per day</h2>
        <div style={sparkStyle}>
          {summary.timeseries.length === 0 ? (
            <p style={noteStyle}>No paid meter events in this window.</p>
          ) : (
            <div style={barRowStyle}>
              {summary.timeseries.map(point => {
                const max = summary.timeseries.reduce(
                  (acc, p) => (p.micro > acc ? p.micro : acc),
                  0n
                );
                const height =
                  max === 0n
                    ? 2
                    : Math.max(2, Math.round((Number(point.micro) / Number(max)) * 96));
                return (
                  <div
                    key={point.bucketStartedAt.toISOString()}
                    title={`${point.bucketStartedAt.toISOString().slice(0, 10)} · $${formatMicroUsdc(point.micro)} · ${point.calls} calls`}
                    style={{
                      ...barStyle,
                      height,
                    }}
                  />
                );
              })}
            </div>
          )}
        </div>
      </section>

      <section style={sectionStyle}>
        <h2 style={h2Style}>Spend · per tool</h2>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Tool</th>
              <th style={thStyle}>Calls</th>
              <th style={thStyle}>Spend (USDC)</th>
            </tr>
          </thead>
          <tbody>
            {summary.perTool.map(row => (
              <tr key={row.toolName}>
                <td style={tdStyle}>
                  <code>{row.toolName}</code>
                </td>
                <td style={tdStyle}>{row.calls}</td>
                <td style={tdStyle}>${formatMicroUsdc(row.micro)}</td>
              </tr>
            ))}
            {summary.perTool.length === 0 && (
              <tr>
                <td style={tdStyle} colSpan={3}>
                  <span style={noteStyle}>No tool calls in this window.</span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section style={sectionStyle}>
        <h2 style={h2Style}>Caps</h2>
        {caps.length === 0 ? (
          <p style={noteStyle}>No spend caps configured for this tenant.</p>
        ) : (
          <ul style={listStyle}>
            {caps.map(cap => (
              <li key={cap.period} style={liStyle}>
                <strong>{cap.period}</strong> — ${formatMicroUsdc(cap.amountMicroUsdc)} ·{' '}
                {cap.hardCap ? 'hard cap (blocks)' : 'soft cap (alerts only)'}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section style={sectionStyle}>
        <h2 style={h2Style}>Recent batches</h2>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Batch</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Events</th>
              <th style={thStyle}>Total</th>
              <th style={thStyle}>Tx</th>
              <th style={thStyle}>Settled</th>
            </tr>
          </thead>
          <tbody>
            {recentBatches.map(batch => (
              <tr key={batch.id}>
                <td style={tdStyle}>
                  <code>{batch.id.slice(0, 8)}</code>
                </td>
                <td style={tdStyle}>{batch.status}</td>
                <td style={tdStyle}>{batch.eventCount}</td>
                <td style={tdStyle}>${formatMicroUsdc(batch.totalMicroUsdc)}</td>
                <td style={tdStyle}>
                  {batch.txHash ? <code>{batch.txHash.slice(0, 10)}…</code> : '—'}
                </td>
                <td style={tdStyle}>
                  {batch.settledAt
                    ? batch.settledAt.toISOString().replace('T', ' ').slice(0, 16)
                    : '—'}
                </td>
              </tr>
            ))}
            {recentBatches.length === 0 && (
              <tr>
                <td style={tdStyle} colSpan={6}>
                  <span style={noteStyle}>No batches yet.</span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}

// ─── Prisma-backed AnalyticsStore ──────────────────────────────────────

function makeAnalyticsStore() {
  return {
    sumSpentInWindow: async ({
      tenantId,
      from,
      to,
    }: {
      tenantId: string;
      from: Date;
      to: Date;
    }): Promise<bigint> => {
      const agg = await prisma.meterEvent.aggregate({
        where: { tenantId, status: 'paid', at: { gte: from, lte: to } },
        _sum: { priceMicroUsdc: true },
      });
      return agg._sum.priceMicroUsdc ?? 0n;
    },
    countCallsInWindow: async ({
      tenantId,
      from,
      to,
    }: {
      tenantId: string;
      from: Date;
      to: Date;
    }): Promise<number> => {
      return prisma.meterEvent.count({
        where: { tenantId, status: 'paid', at: { gte: from, lte: to } },
      });
    },
    spendByToolInWindow: async ({
      tenantId,
      from,
      to,
    }: {
      tenantId: string;
      from: Date;
      to: Date;
    }) => {
      const rows = await prisma.meterEvent.groupBy({
        by: ['toolName'],
        where: { tenantId, status: 'paid', at: { gte: from, lte: to } },
        _count: true,
        _sum: { priceMicroUsdc: true },
      });
      return rows.map(r => ({
        toolName: r.toolName,
        calls: r._count,
        micro: r._sum.priceMicroUsdc ?? 0n,
      }));
    },
    spendTimeseries: async ({
      tenantId,
      from,
      to,
    }: {
      tenantId: string;
      from: Date;
      to: Date;
      bucket: 'hour' | 'day';
    }) => {
      // In-process day bucketing — good for <10k rows per tenant per week.
      // Phase 4 can swap to a Postgres `date_trunc` raw query if volume grows.
      const events = await prisma.meterEvent.findMany({
        where: { tenantId, status: 'paid', at: { gte: from, lte: to } },
        select: { at: true, priceMicroUsdc: true },
        orderBy: { at: 'asc' },
        take: 10_000,
      });
      const bucket = new Map<string, { micro: bigint; calls: number }>();
      for (const e of events) {
        const key = e.at.toISOString().slice(0, 10);
        const existing = bucket.get(key) ?? { micro: 0n, calls: 0 };
        existing.micro += e.priceMicroUsdc;
        existing.calls += 1;
        bucket.set(key, existing);
      }
      return [...bucket.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => ({
          bucketStartedAt: new Date(`${k}T00:00:00Z`),
          micro: v.micro,
          calls: v.calls,
        }));
    },
  };
}

// ─── tiny UI pieces (inline styles — no Tailwind in apps/app today) ───

function Kpi({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div style={kpiCardStyle}>
      <div style={kpiLabelStyle}>{label}</div>
      <div style={{ ...kpiValueStyle, color: accent ?? '#111' }}>{value}</div>
      {sub && <div style={kpiSubStyle}>{sub}</div>}
    </div>
  );
}

const rootStyle: React.CSSProperties = {
  maxWidth: 1080,
  margin: '0 auto',
  padding: '48px 24px 80px',
  fontFamily:
    'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial',
  color: '#111',
};
const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'space-between',
  marginBottom: 32,
};
const eyebrowStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 10,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: '#8a8a8a',
  marginBottom: 4,
};
const h1Style: React.CSSProperties = {
  fontSize: 32,
  letterSpacing: '-0.03em',
  margin: 0,
  fontWeight: 500,
};
const h2Style: React.CSSProperties = {
  fontSize: 14,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  color: '#555',
  margin: '32px 0 12px',
};
const badgeStyle: React.CSSProperties = {
  padding: '4px 10px',
  border: '1px solid #111',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 11,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
};
const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, 1fr)',
  gap: 12,
  marginBottom: 16,
};
const sectionStyle: React.CSSProperties = { marginBottom: 24 };
const kpiCardStyle: React.CSSProperties = {
  border: '1px solid #e6e6e6',
  padding: '14px 16px',
};
const kpiLabelStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 10,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: '#8a8a8a',
  marginBottom: 6,
};
const kpiValueStyle: React.CSSProperties = {
  fontSize: 22,
  letterSpacing: '-0.01em',
  fontWeight: 500,
};
const kpiSubStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 10,
  color: '#8a8a8a',
  marginTop: 4,
  letterSpacing: '0.06em',
};
const sparkStyle: React.CSSProperties = {
  border: '1px solid #e6e6e6',
  padding: 16,
  minHeight: 120,
};
const barRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-end',
  gap: 4,
  height: 100,
};
const barStyle: React.CSSProperties = {
  flex: 1,
  background: '#111',
  borderRadius: 1,
  minHeight: 2,
};
const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 13,
};
const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 10px',
  borderBottom: '1px solid #e6e6e6',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 10,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: '#555',
};
const tdStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderBottom: '1px solid #f0f0f0',
};
const listStyle: React.CSSProperties = { listStyle: 'none', padding: 0, margin: 0 };
const liStyle: React.CSSProperties = {
  padding: '8px 0',
  borderBottom: '1px solid #f0f0f0',
  fontSize: 13,
};
const noteStyle: React.CSSProperties = { color: '#8a8a8a', fontSize: 13 };
