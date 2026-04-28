/**
 * /dashboard/caps/policies — list of TransferPolicy rows.
 *
 *   Crumb · h1 · lede · "New policy" CTA
 *   Filter chips: All / Tenant / Travelers / Tools
 *   Editorial table: Subject · Guard · Summary · Hard/soft · Status
 *
 * Reads only the fields the editor + runtime parser care about.
 * Soft caps and disabled rows are visually muted but still render so
 * an operator can re-enable them in one click.
 */

import Link from 'next/link';

import { prisma } from '@sendero/database';

import { requireRole } from '@/lib/require-role';
import { requireCurrentTenant } from '@/lib/tenant-context';

import { deleteTransferPolicy, toggleTransferPolicy } from './actions';

export const dynamic = 'force-dynamic';

type ScopeFilter = 'all' | 'tenant' | 'traveler' | 'tool';

export default async function PoliciesPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  await requireRole('org:admin');
  const { tenant } = await requireCurrentTenant();
  const params = await searchParams;
  const filter = parseScopeFilter(params.scope);

  const [policies, scopeCounts] = await Promise.all([
    prisma.transferPolicy.findMany({
      where: {
        tenantId: tenant.id,
        ...(filter === 'all' ? {} : { scope: filter }),
      },
      orderBy: [{ scope: 'asc' }, { priority: 'asc' }, { createdAt: 'desc' }],
      include: {
        traveler: { select: { displayName: true, email: true } },
      },
    }),
    prisma.transferPolicy.groupBy({
      by: ['scope'],
      where: { tenantId: tenant.id },
      _count: { _all: true },
    }),
  ]);

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
          <h1 className="t-h1">Transfer policies</h1>
          <p className="t-body-lg ink-70" style={{ marginTop: 6, maxWidth: '60ch' }}>
            Composable spending guards. Each row is one guard — budget, single-tx, recipient,
            rate-limit, or manual approval — scoped to the tenant, a traveler, or a tool. The chain
            runs on every payment.
          </p>
        </div>
        <Link href="/dashboard/caps/policies/new" style={primaryBtnStyle}>
          New policy
        </Link>
      </div>

      <ScopeFilterBar active={filter} counts={scopeCounts} />

      {policies.length === 0 ? (
        <EmptyState filter={filter} />
      ) : (
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
              gridTemplateColumns: '1.1fr 0.8fr 1.4fr 0.7fr 0.6fr 1fr',
              padding: '14px 22px',
              borderBottom: '1px solid var(--hairline-color)',
            }}
          >
            {['Subject', 'Guard', 'Summary', 'Type', 'Status', 'Actions'].map(h => (
              <div key={h} className="t-meta">
                {h}
              </div>
            ))}
          </div>
          {policies.map((p, i) => {
            const summary = guardSummary(p.guardKind, p.config);
            const subject = subjectLabel(p);
            return (
              <div
                key={p.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1.1fr 0.8fr 1.4fr 0.7fr 0.6fr 1fr',
                  padding: '14px 22px',
                  borderBottom:
                    i < policies.length - 1 ? '1px solid var(--hairline-color-soft)' : 'none',
                  alignItems: 'center',
                  opacity: p.enabled ? 1 : 0.55,
                }}
              >
                <div className="t-body" style={{ fontWeight: 500, fontSize: 13 }}>
                  {subject}
                </div>
                <div className="t-mono ink-70" style={{ fontSize: 12 }}>
                  {p.guardKind.replace('_', ' ')}
                </div>
                <div className="t-mono ink-70" style={{ fontSize: 11 }}>
                  {summary}
                </div>
                <div className="t-mono ink-70" style={{ fontSize: 12 }}>
                  {p.guardKind === 'budget' || p.guardKind === 'rate_limit'
                    ? p.hardCap
                      ? 'hard'
                      : 'soft'
                    : '—'}
                </div>
                <div>
                  <span
                    className={`sd-pill sd-pill-${p.enabled ? 'sea' : 'outline'}`}
                    style={{ fontSize: 9, padding: '2px 7px', fontWeight: 700 }}
                  >
                    {p.enabled ? 'ACTIVE' : 'PAUSED'}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Link
                    href={`/dashboard/caps/policies/${p.id}`}
                    className="t-mono ink-60"
                    style={{ fontSize: 10, textDecoration: 'underline' }}
                  >
                    edit
                  </Link>
                  <form action={toggleTransferPolicy} style={{ display: 'inline' }}>
                    <input type="hidden" name="id" value={p.id} />
                    <button type="submit" style={inlineBtnStyle}>
                      {p.enabled ? 'pause' : 'resume'}
                    </button>
                  </form>
                  <form action={deleteTransferPolicy} style={{ display: 'inline' }}>
                    <input type="hidden" name="id" value={p.id} />
                    <button type="submit" style={{ ...inlineBtnStyle, color: 'var(--vermillion)' }}>
                      remove
                    </button>
                  </form>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function parseScopeFilter(value: string | undefined): ScopeFilter {
  if (value === 'tenant' || value === 'traveler' || value === 'tool') return value;
  return 'all';
}

function ScopeFilterBar({
  active,
  counts,
}: {
  active: ScopeFilter;
  counts: Array<{ scope: string; _count: { _all: number } }>;
}) {
  const total = counts.reduce((acc, c) => acc + c._count._all, 0);
  const get = (s: string) => counts.find(c => c.scope === s)?._count._all ?? 0;
  const items: Array<{ value: ScopeFilter; label: string; count: number }> = [
    { value: 'all', label: 'All', count: total },
    { value: 'tenant', label: 'Tenant', count: get('tenant') },
    { value: 'traveler', label: 'Travelers', count: get('traveler') },
    { value: 'tool', label: 'Tools', count: get('tool') },
  ];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span className="t-meta">Filter</span>
      {items.map(item => {
        const isActive = item.value === active;
        const href =
          item.value === 'all'
            ? '/dashboard/caps/policies'
            : `/dashboard/caps/policies?scope=${item.value}`;
        return (
          <Link
            key={item.value}
            href={href}
            className="sd-pill"
            style={{
              padding: '4px 10px',
              fontSize: 11,
              fontFamily: 'var(--font-mono-x)',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              textDecoration: 'none',
              background: isActive ? 'var(--vermillion)' : 'var(--surface-floating)',
              color: isActive ? '#fdfbf7' : 'var(--midnight)',
              boxShadow: isActive ? 'none' : 'inset 0 0 0 1px var(--hairline-color)',
            }}
          >
            {item.label} · {item.count}
          </Link>
        );
      })}
    </div>
  );
}

function EmptyState({ filter }: { filter: ScopeFilter }) {
  return (
    <div
      className="sd-card-flat"
      style={{
        boxShadow: 'inset 0 0 0 1px var(--hairline-color)',
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
        ⛨
      </div>
      <div className="t-h3">{filter === 'all' ? 'No policies yet' : `No ${filter} policies`}</div>
      <div className="t-body ink-70" style={{ fontSize: 13, maxWidth: '52ch', lineHeight: 1.55 }}>
        Build the first guard and the runtime starts gating spend on every dispatch and Unified
        Balance Kit transfer.
      </div>
      <Link href="/dashboard/caps/policies/new" style={primaryBtnStyle}>
        New policy
      </Link>
    </div>
  );
}

interface PolicyRowWithTraveler {
  scope: string;
  travelerId: string | null;
  toolName: string | null;
  traveler: { displayName: string | null; email: string | null } | null;
}

function subjectLabel(row: PolicyRowWithTraveler): string {
  if (row.scope === 'traveler') {
    return row.traveler?.displayName ?? row.traveler?.email ?? row.travelerId ?? 'Unknown traveler';
  }
  if (row.scope === 'tool') {
    return row.toolName ?? 'unknown tool';
  }
  return 'Tenant total';
}

function guardSummary(kind: string, config: unknown): string {
  if (!config || typeof config !== 'object') return '—';
  const cfg = config as Record<string, unknown>;
  switch (kind) {
    case 'budget':
      return `${cfg.period ?? '?'} ≤ ${formatMicro(cfg.capMicroUsdc)}`;
    case 'single_tx':
      return `≤ ${formatMicro(cfg.maxMicroUsdc)} / tx`;
    case 'recipient': {
      const list = Array.isArray(cfg.addresses) ? (cfg.addresses as string[]) : [];
      return `${cfg.mode ?? '?'} · ${list.length} addr`;
    }
    case 'rate_limit':
      return `${cfg.maxCount ?? '?'} / ${formatWindow(Number(cfg.windowMs))}`;
    case 'confirm': {
      const trigger = formatMicro(cfg.triggerAtMicroUsdc);
      return trigger === '—' ? 'every payment' : `≥ ${trigger}`;
    }
    default:
      return '—';
  }
}

function formatMicro(value: unknown): string {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return '—';
  const n = BigInt(value);
  const whole = n / 1_000_000n;
  const frac = n % 1_000_000n;
  const fracStr = frac.toString().padStart(6, '0').replace(/0+$/, '');
  return fracStr ? `$${whole}.${fracStr}` : `$${whole}`;
}

function formatWindow(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '?';
  if (ms >= 86_400_000) return `${Math.round(ms / 86_400_000)}d`;
  if (ms >= 3_600_000) return `${Math.round(ms / 3_600_000)}h`;
  if (ms >= 60_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 1000)}s`;
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

const inlineBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 0,
  padding: 0,
  cursor: 'pointer',
  fontFamily: 'var(--font-mono-x)',
  fontSize: 10,
  textDecoration: 'underline',
  color: 'rgba(31,42,68,0.6)',
};
