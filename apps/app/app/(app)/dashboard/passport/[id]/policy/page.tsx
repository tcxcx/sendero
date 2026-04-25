/**
 * /dashboard/passport/[id]/policy — per-traveler policy view.
 *
 *   Crumb · h1 (traveler) · lede · "New policy for this traveler" CTA
 *   List of TransferPolicy rows scoped to this traveler.
 *
 * The "New policy" link prefills `?travelerId=…&scope=traveler` so the
 * editor opens with scope locked. Tenant-wide rows aren't shown here —
 * those live on /dashboard/caps/policies.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';

import { prisma } from '@sendero/database';

import { Crumb } from '@/components/console/crumb';
import { requireRole } from '@/lib/require-role';
import { requireCurrentTenant } from '@/lib/tenant-context';

import { deleteTransferPolicy, toggleTransferPolicy } from '../../../caps/policies/actions';

export const dynamic = 'force-dynamic';

export default async function TravelerPolicyPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('org:admin');
  const { tenant } = await requireCurrentTenant();
  const { id } = await params;

  const traveler = await prisma.user.findFirst({
    where: { id, memberships: { some: { tenantId: tenant.id } } },
    select: { id: true, displayName: true, email: true },
  });
  if (!traveler) notFound();

  const policies = await prisma.transferPolicy.findMany({
    where: { tenantId: tenant.id, scope: 'traveler', travelerId: id },
    orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
  });

  const label = traveler.displayName ?? traveler.email ?? traveler.id.slice(0, 12);

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
      <Crumb trail={['Workspace', 'Passport', label, 'Policy']} />

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
          <h1 className="t-h1">{label}</h1>
          <p className="t-body-lg ink-70" style={{ marginTop: 6, maxWidth: '60ch' }}>
            Per-traveler spending guards. Composed alongside tenant-wide policies at runtime — both
            apply on every dispatch and Unified Balance Kit transfer for this traveler.
          </p>
        </div>
        <Link
          href={`/dashboard/caps/policies/new?scope=traveler&travelerId=${id}`}
          style={primaryBtnStyle}
        >
          New policy
        </Link>
      </div>

      {policies.length === 0 ? (
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
          <div className="t-h3">No traveler-scoped policies</div>
          <div
            className="t-body ink-70"
            style={{ fontSize: 13, maxWidth: '52ch', lineHeight: 1.55 }}
          >
            Tenant-wide policies still apply. Add a guard here to layer per-traveler limits on top —
            useful for executive travelers, contractors, or any user that needs a tighter ceiling
            than the org default.
          </div>
          <Link
            href={`/dashboard/caps/policies/new?scope=traveler&travelerId=${id}`}
            style={primaryBtnStyle}
          >
            New policy
          </Link>
        </div>
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
              gridTemplateColumns: '1fr 1.6fr 0.7fr 0.6fr 0.8fr',
              padding: '14px 22px',
              borderBottom: '1px solid var(--hairline-color)',
            }}
          >
            {['Guard', 'Summary', 'Type', 'Status', 'Actions'].map(h => (
              <div key={h} className="t-meta">
                {h}
              </div>
            ))}
          </div>
          {policies.map((p, i) => (
            <div
              key={p.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1.6fr 0.7fr 0.6fr 0.8fr',
                padding: '14px 22px',
                borderBottom:
                  i < policies.length - 1 ? '1px solid var(--hairline-color-soft)' : 'none',
                alignItems: 'center',
                opacity: p.enabled ? 1 : 0.55,
              }}
            >
              <div className="t-mono ink-70" style={{ fontSize: 12 }}>
                {p.guardKind.replace('_', ' ')}
              </div>
              <div className="t-mono ink-70" style={{ fontSize: 11 }}>
                {summaryFor(p.guardKind, p.config)}
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
              <div style={{ display: 'flex', gap: 8 }}>
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
          ))}
        </div>
      )}
    </div>
  );
}

function summaryFor(kind: string, config: unknown): string {
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
      const t = formatMicro(cfg.triggerAtMicroUsdc);
      return t === '—' ? 'every payment' : `≥ ${t}`;
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
