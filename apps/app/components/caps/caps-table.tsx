/**
 * CapsTable — editorial table mirroring `route-artboards.jsx::CapsA`.
 *
 *   Cap   ·  Period  ·  Hard / soft  ·  Used  ·  Status
 *   row     daily      hard $X         91%      WITHIN/WARN/BREACH
 *
 * Used and Status are computed from real `meterEvent` aggregates +
 * the cap's own `amountMicroUsdc`. Per-traveler / per-tool scopes
 * from the design canvas aren't in the schema yet, so for now every
 * cap is rendered as a `tenant total` row.
 */

import Link from 'next/link';

import { formatMicroUsd } from '@/lib/format';

import { deleteCapAction } from '@/app/(app)/dashboard/caps/actions';

export interface CapTableRow {
  id: string;
  period: 'daily' | 'monthly' | string;
  amountMicroUsdc: bigint;
  hardCap: boolean;
  alertWebhookUrl: string | null;
  usedMicro: bigint;
}

export function CapsTable({ rows }: { rows: CapTableRow[] }) {
  return (
    <div
      className="sd-card-flat"
      style={{
        boxShadow: 'inset 0 0 0 1px var(--hairline-color)',
        padding: 0,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1.5fr 1fr 1fr 1fr 140px',
          padding: '14px 22px',
          borderBottom: '1px solid var(--hairline-color)',
        }}
      >
        {['Cap', 'Period', 'Hard / soft', 'Used', 'Status'].map(h => (
          <div key={h} className="t-meta">
            {h}
          </div>
        ))}
      </div>
      {rows.length === 0 ? (
        <div
          style={{
            padding: '24px 22px',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <span className="t-body" style={{ fontSize: 13, color: 'var(--midnight)' }}>
            No caps yet
          </span>
          <span className="t-body ink-70" style={{ fontSize: 12 }}>
            Add a cap to start guarding agent spend.{' '}
            <Link
              href="/dashboard/caps/new"
              style={{ color: 'var(--vermillion)', textDecoration: 'underline' }}
            >
              New cap policy
            </Link>
          </span>
        </div>
      ) : (
        rows.map((row, i) => {
          const ceiling = row.amountMicroUsdc;
          const pct = ceiling > 0n ? Number((row.usedMicro * 1000n) / ceiling) / 10 : 0;
          const status =
            pct >= 100
              ? { label: 'BREACH', tone: 'verm' as const }
              : pct >= 80
                ? { label: 'WARN', tone: 'sand' as const }
                : { label: 'WITHIN', tone: 'sea' as const };
          return (
            <div
              key={row.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '1.5fr 1fr 1fr 1fr 140px',
                padding: '14px 22px',
                borderBottom: i < rows.length - 1 ? '1px solid var(--hairline-color-soft)' : 'none',
                alignItems: 'center',
              }}
            >
              <div className="t-body" style={{ fontWeight: 500, fontSize: 13 }}>
                Tenant total
                {row.alertWebhookUrl ? (
                  <span className="t-mono ink-60" style={{ fontSize: 10, marginLeft: 8 }}>
                    · alert webhook
                  </span>
                ) : null}
              </div>
              <div className="t-mono ink-70" style={{ fontSize: 12, textTransform: 'capitalize' }}>
                {row.period}
              </div>
              <div className="t-mono ink-70" style={{ fontSize: 12 }}>
                {row.hardCap
                  ? `hard · ${formatMicroUsd(row.amountMicroUsdc)}`
                  : `soft · ${formatMicroUsd(row.amountMicroUsdc)}`}
              </div>
              <div className="t-mono" style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
                {pct.toFixed(0)}%
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span
                  className={`sd-pill sd-pill-${status.tone}`}
                  style={{ fontSize: 9, padding: '2px 7px', fontWeight: 700 }}
                >
                  {status.label}
                </span>
                <Link
                  href={`/dashboard/caps/new?period=${row.period}`}
                  className="t-mono ink-60"
                  style={{ fontSize: 10, textDecoration: 'underline' }}
                >
                  edit
                </Link>
                <form action={deleteCapAction} style={{ display: 'inline' }}>
                  <input type="hidden" name="period" value={row.period} />
                  <button
                    type="submit"
                    className="t-mono ink-60"
                    style={{
                      fontSize: 10,
                      background: 'transparent',
                      border: 0,
                      cursor: 'pointer',
                      padding: 0,
                      textDecoration: 'underline',
                      color: 'var(--vermillion)',
                    }}
                  >
                    remove
                  </button>
                </form>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
