/**
 * /dashboard/caps — CapsA layout.
 *
 *   Crumb · h1 · lede + "Add cap" CTA
 *   Hero card with daily / weekly / monthly gauges (real meterEvent
 *   aggregates, real `tenantSpendCap` ceilings).
 *   Editorial table with Cap / Period / Hard-soft / Used / Status,
 *   driven by the same data so the table rows agree with the gauges.
 *
 * Per-traveler / per-tool scopes from the design canvas aren't in the
 * schema yet (TenantSpendCap has just `daily | monthly` periods + a
 * single `tenantId` scope). This page renders what we have honestly;
 * extending to per-traveler / per-tool / quarterly is a follow-up
 * landing strip.
 */

import Link from 'next/link';

import { prisma } from '@sendero/database';

import { CapsGauge } from '@/components/caps/caps-gauge';
import { CapsTable, type CapTableRow } from '@/components/caps/caps-table';
import { PageActions } from '@/components/dashboard/page-actions';
import { requireRole } from '@/lib/require-role';
import { requireCurrentTenant } from '@/lib/tenant-context';

export const dynamic = 'force-dynamic';

const DAY_MS = 24 * 60 * 60 * 1000;

async function sumPaidMicro(tenantId: string, sinceMs: number): Promise<bigint> {
  const agg = await prisma.meterEvent.aggregate({
    where: {
      tenantId,
      status: 'paid',
      at: { gte: new Date(Date.now() - sinceMs) },
    },
    _sum: { priceMicroUsdc: true },
  });
  return agg._sum.priceMicroUsdc ?? 0n;
}

export default async function CapsPage() {
  await requireRole('org:admin');
  const { tenant } = await requireCurrentTenant();

  const caps = await prisma.tenantSpendCap.findMany({
    where: { tenantId: tenant.id },
    orderBy: { period: 'asc' },
  });

  const dailyCap = caps.find(c => c.period === 'daily') ?? null;
  const monthlyCap = caps.find(c => c.period === 'monthly') ?? null;

  const [dailyUsed, weeklyUsed, monthlyUsed] = await Promise.all([
    sumPaidMicro(tenant.id, DAY_MS),
    sumPaidMicro(tenant.id, 7 * DAY_MS),
    sumPaidMicro(tenant.id, 30 * DAY_MS),
  ]);

  // Synthesize a "weekly" ceiling = 7 × daily, and use monthly directly.
  const weeklyCeilingMicro = dailyCap ? dailyCap.amountMicroUsdc * 7n : null;

  const tableRows: CapTableRow[] = caps.map(c => ({
    id: c.id,
    period: c.period,
    amountMicroUsdc: c.amountMicroUsdc,
    hardCap: c.hardCap,
    alertWebhookUrl: c.alertWebhookUrl,
    usedMicro: c.period === 'daily' ? dailyUsed : monthlyUsed,
  }));

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
      <PageActions>
        <Link
          href="/dashboard/caps/policies"
          style={{
            padding: '8px 14px',
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
            textDecoration: 'none',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
          }}
        >
          Manage policies →
        </Link>
        <Link
          href="/dashboard/caps/new"
          style={{
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
            textDecoration: 'none',
            cursor: 'pointer',
          }}
        >
          {caps.length === 0 ? 'New cap policy' : 'Add cap'}
        </Link>
      </PageActions>

      <div
        className="sd-card-raised"
        style={{
          padding: '0 20px 20px',
          display: 'flex',
          gap: 0,
          alignItems: 'stretch',
        }}
      >
        <CapsGauge
          label="Today"
          usedMicro={dailyUsed}
          ceilingMicro={dailyCap?.amountMicroUsdc ?? null}
        />
        <Divider />
        <CapsGauge label="This week" usedMicro={weeklyUsed} ceilingMicro={weeklyCeilingMicro} />
        <Divider />
        <CapsGauge
          label="This month"
          usedMicro={monthlyUsed}
          ceilingMicro={monthlyCap?.amountMicroUsdc ?? null}
        />
      </div>

      <CapsTable rows={tableRows} />
    </div>
  );
}

function Divider() {
  return (
    <div
      aria-hidden
      style={{
        width: 1,
        background: 'var(--hairline-color)',
        alignSelf: 'stretch',
        margin: '0 24px',
      }}
    />
  );
}
