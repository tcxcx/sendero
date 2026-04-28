/**
 * /dashboard/caps/new — CapsB policy editor.
 *
 *   1.3fr/1fr grid. Left: rule composition (period, threshold, type,
 *   alert webhook). Right: real 30-day preview — sum of daily/monthly
 *   meterEvent spend that would have hit the configured threshold.
 *
 * Edit-existing-cap variant: `?period=daily|monthly` pre-fills the
 * form from the existing row so this route doubles as the edit
 * surface (no separate /caps/[id]/edit page needed since the natural
 * key is `(tenantId, period)`).
 *
 * Auto-raise / auto-block / per-traveler / per-tool from the design
 * canvas aren't in `TenantSpendCap` today. The editor only renders
 * fields that persist; extending those is a follow-up landing strip.
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';

import { type CapPeriod, prisma } from '@sendero/database';

import { Crumb } from '@/components/console/crumb';
import { formatMicroUsd } from '@/lib/format';
import { requireRole } from '@/lib/require-role';
import { requireCurrentTenant } from '@/lib/tenant-context';

import { upsertCapAction } from '../actions';

export const dynamic = 'force-dynamic';

const DAY_MS = 24 * 60 * 60 * 1000;

type SearchParams = { period?: string };

export default async function NewCapPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireRole('org:admin');
  const { tenant } = await requireCurrentTenant();
  const params = await searchParams;
  const editingPeriod: CapPeriod | null =
    params.period === 'daily' ? 'daily' : params.period === 'monthly' ? 'monthly' : null;

  const existing = editingPeriod
    ? await prisma.tenantSpendCap.findUnique({
        where: { tenantId_period: { tenantId: tenant.id, period: editingPeriod } },
      })
    : null;

  const defaultPeriod: CapPeriod = existing?.period ?? 'daily';
  const defaultAmount = existing
    ? microToDecimalString(existing.amountMicroUsdc)
    : defaultPeriod === 'daily'
      ? '50.00'
      : '1500.00';
  const defaultHard = existing?.hardCap ?? true;
  const defaultAlertUrl = existing?.alertWebhookUrl ?? '';

  // Real 30d events for the preview panel.
  const since = new Date(Date.now() - 30 * DAY_MS);
  const events = await prisma.meterEvent.findMany({
    where: { tenantId: tenant.id, status: 'paid', at: { gte: since } },
    select: { at: true, priceMicroUsdc: true, toolName: true },
    orderBy: { at: 'desc' },
    take: 5000,
  });

  const preview = computePreview(events, defaultPeriod, parseDecimal(defaultAmount));

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
      <Crumb
        trail={['Money & policy', 'Caps', existing ? `Edit · ${existing.period}` : 'New policy']}
      />

      <div>
        <h1 className="t-h1">{existing ? 'Edit cap policy' : 'New cap policy'}</h1>
        <p className="t-body-lg ink-70" style={{ marginTop: 6, maxWidth: '60ch' }}>
          Compose a rule. Preview against the last 30 days of paid meter events before saving.
        </p>
      </div>

      <div
        style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: '1.3fr 1fr',
          gap: 24,
          minHeight: 0,
        }}
      >
        {/* LEFT — rule editor */}
        <form
          action={async (formData: FormData) => {
            'use server';
            await upsertCapAction(formData);
            redirect('/dashboard/caps');
          }}
          className="sd-card-raised"
          style={{
            padding: '0 20px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
          }}
        >
          <div className="t-meta">Rule</div>

          <RuleRow label="Scope">
            <ReadOnlyField value="Tenant — applies to every meter event for this org" />
            <span className="t-mono ink-60" style={{ fontSize: 10, marginLeft: 12 }}>
              Per-traveler / per-tool scopes — landing alongside `@sendero/transfer-policy`
            </span>
          </RuleRow>

          <RuleRow label="Period">
            <select
              name="period"
              defaultValue={defaultPeriod}
              style={fieldStyle}
              className="t-body"
            >
              <option value="daily">Daily — rolls every 24h</option>
              <option value="monthly">Monthly — rolls on the 1st</option>
            </select>
          </RuleRow>

          <RuleRow label="Type">
            <label
              style={{
                ...fieldStyle,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <input
                type="checkbox"
                name="hardCap"
                defaultChecked={defaultHard}
                style={{ accentColor: 'var(--vermillion)' }}
              />
              <span className="t-body" style={{ fontSize: 13 }}>
                Hard cap — reject further calls when the threshold is crossed
              </span>
            </label>
            <span className="t-mono ink-60" style={{ fontSize: 10, marginLeft: 12 }}>
              Uncheck for soft cap (alert + keep going)
            </span>
          </RuleRow>

          <RuleRow label="Threshold">
            <div
              style={{
                ...fieldStyle,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <span className="t-mono ink-60" style={{ fontSize: 13 }}>
                $
              </span>
              <input
                name="amountUsdc"
                defaultValue={defaultAmount}
                pattern="\d+(\.\d{1,6})?"
                required
                style={{
                  flex: 1,
                  border: 0,
                  outline: 'none',
                  background: 'transparent',
                  fontFamily: 'var(--font-mono-x)',
                  fontSize: 14,
                  color: 'var(--midnight)',
                }}
              />
              <span className="t-mono ink-60" style={{ fontSize: 11 }}>
                USDC
              </span>
            </div>
          </RuleRow>

          <RuleRow label="Alert webhook">
            <input
              name="alertWebhookUrl"
              type="url"
              defaultValue={defaultAlertUrl}
              placeholder="https://hooks.example.com/cap-breach (optional)"
              style={{
                ...fieldStyle,
                border: 0,
                outline: 'none',
                fontFamily: 'var(--font-mono-x)',
                fontSize: 12,
              }}
            />
          </RuleRow>

          <hr
            aria-hidden
            style={{
              border: 0,
              height: 1,
              background: 'var(--hairline-color-soft)',
              margin: '6px 0',
            }}
          />

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Link href="/dashboard/caps" className="sd-pill sd-pill-outline" style={ghostBtnStyle}>
              Discard
            </Link>
            <span style={{ flex: 1 }} />
            <button type="submit" style={primaryBtnStyle}>
              {existing ? 'Save changes' : 'Save policy'}
            </button>
          </div>
        </form>

        {/* RIGHT — real 30d preview */}
        <div
          className="sd-card-flat"
          style={{
            boxShadow: 'inset 0 0 0 1px var(--hairline-color)',
            padding: '20px 24px',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          <div className="t-meta">Preview · last 30 days</div>
          <div
            className="t-num-lg"
            style={{ fontSize: 40, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}
          >
            {preview.breachCount}
            <span className="t-mono ink-60" style={{ fontSize: 14, marginLeft: 8 }}>
              {defaultPeriod === 'daily' ? 'day' : 'month'}
              {preview.breachCount === 1 ? '' : 's'} over threshold
            </span>
          </div>
          <p className="t-body ink-70" style={{ fontSize: 13, lineHeight: 1.5 }}>
            Real paid meter events for this tenant. Buckets shown are{' '}
            {defaultPeriod === 'daily' ? 'days' : 'calendar months'} where the total spend would
            have crossed <span className="t-mono">{formatDecimalUsd(defaultAmount)}</span>.
          </p>

          <hr
            aria-hidden
            style={{
              border: 0,
              height: 1,
              background: 'var(--hairline-color-soft)',
              margin: 0,
            }}
          />

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 0,
              maxHeight: 280,
              overflow: 'auto',
            }}
          >
            {preview.buckets.length === 0 ? (
              <div className="t-body ink-60" style={{ fontSize: 13 }}>
                No paid meter events in the last 30 days. Save the policy and it&rsquo;ll start
                guarding the next call.
              </div>
            ) : (
              preview.buckets.slice(0, 12).map((b, i) => {
                const tone =
                  b.totalMicro > parseDecimal(defaultAmount) * 1_000_000n
                    ? 'verm'
                    : b.totalMicro > (parseDecimal(defaultAmount) * 1_000_000n * 8n) / 10n
                      ? 'sand'
                      : 'sea';
                return (
                  <div
                    key={b.label}
                    style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      justifyContent: 'space-between',
                      padding: '8px 0',
                      borderBottom:
                        i < preview.buckets.length - 1 && i < 11
                          ? '1px solid var(--hairline-color-soft)'
                          : 'none',
                      gap: 12,
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div className="t-body" style={{ fontSize: 13, fontWeight: 500 }}>
                        {b.label}
                      </div>
                      <div className="t-mono ink-60" style={{ fontSize: 11, marginTop: 2 }}>
                        {b.calls} call{b.calls === 1 ? '' : 's'}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span
                        className="t-num-md"
                        style={{ fontSize: 14, fontVariantNumeric: 'tabular-nums' }}
                      >
                        {formatMicroUsd(b.totalMicro)}
                      </span>
                      <span
                        className={`sd-pill sd-pill-${tone}`}
                        style={{ fontSize: 9, padding: '2px 7px', fontWeight: 700 }}
                      >
                        {tone === 'verm' ? 'BREACH' : tone === 'sand' ? 'WARN' : 'WITHIN'}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── helpers + styles ─────────────────────────────────────────

function RuleRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        flexWrap: 'wrap',
      }}
    >
      <div className="t-meta" style={{ width: 140, flexShrink: 0 }}>
        {label}
      </div>
      <div
        style={{ flex: 1, minWidth: 240, display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}
      >
        {children}
      </div>
    </div>
  );
}

function ReadOnlyField({ value }: { value: string }) {
  return (
    <div style={fieldStyle}>
      <span className="t-body" style={{ fontSize: 13 }}>
        {value}
      </span>
    </div>
  );
}

const fieldStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 240,
  padding: '10px 14px',
  background: 'var(--surface-floating)',
  borderRadius: 8,
  boxShadow: 'inset 0 0 0 1px var(--hairline-color-soft)',
  border: 0,
  fontFamily: 'var(--font-sans)',
  fontSize: 13,
  color: 'var(--midnight)',
};

const primaryBtnStyle: React.CSSProperties = {
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
};

const ghostBtnStyle: React.CSSProperties = {
  padding: '6px 14px',
  background: 'transparent',
  color: 'var(--midnight)',
  border: 0,
  boxShadow: 'inset 0 0 0 1px var(--hairline-color)',
  borderRadius: 8,
  fontSize: 11,
  fontWeight: 600,
  fontFamily: 'var(--font-mono-x)',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  cursor: 'pointer',
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
};

interface PreviewBucket {
  label: string;
  totalMicro: bigint;
  calls: number;
}

interface Preview {
  buckets: PreviewBucket[];
  breachCount: number;
}

function computePreview(
  events: Array<{ at: Date; priceMicroUsdc: bigint }>,
  period: CapPeriod,
  thresholdUsdc: bigint
): Preview {
  const buckets = new Map<string, PreviewBucket>();
  for (const e of events) {
    const key = bucketKey(e.at, period);
    const label = bucketLabel(e.at, period);
    const cur = buckets.get(key) ?? { label, totalMicro: 0n, calls: 0 };
    cur.totalMicro += e.priceMicroUsdc;
    cur.calls += 1;
    buckets.set(key, cur);
  }
  const sorted = [...buckets.values()].sort((a, b) =>
    a.label === b.label ? 0 : a.label > b.label ? -1 : 1
  );
  const thresholdMicro = thresholdUsdc * 1_000_000n;
  const breachCount = sorted.filter(b => b.totalMicro > thresholdMicro).length;
  return { buckets: sorted, breachCount };
}

function bucketKey(date: Date, period: CapPeriod): string {
  if (period === 'daily') return date.toISOString().slice(0, 10);
  return date.toISOString().slice(0, 7);
}

function bucketLabel(date: Date, period: CapPeriod): string {
  if (period === 'daily') {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function parseDecimal(decimal: string): bigint {
  const [whole = '0'] = decimal.trim().split('.');
  const n = BigInt(whole);
  return Number.isFinite(Number(decimal)) ? n : 0n;
}

function microToDecimalString(value: bigint): string {
  const whole = value / 1_000_000n;
  const frac = value % 1_000_000n;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(6, '0').replace(/0+$/, '');
  return `${whole}.${fracStr}`;
}

function formatDecimalUsd(decimal: string): string {
  const n = Number(decimal);
  if (!Number.isFinite(n)) return `$${decimal}`;
  if (n >= 1000) return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  return `$${n.toFixed(0)}`;
}
