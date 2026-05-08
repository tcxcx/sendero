/**
 * Phase B — workspace KPI strip as a parallel-routes slot.
 *
 * Streams independently above the inbox. Operators see the KPI
 * skeleton paint immediately while the inbox loads with its own
 * data fetch, then the KPIs swap in when their Postgres aggregates
 * resolve. No render blocking between slots.
 *
 * Renders the same five values the inline ConsoleHero used to show:
 * inFlight + awaiting today, settled-30d count + fare, median
 * agent response. The inline grid is suppressed via `hideKpiStrip`
 * on the page-level MetaInboxLive.
 *
 * Scoped (?tripId=…) mode renders null — the workspace strip is a
 * roll-up over all trips, so it would be confusing alongside a
 * single trip's conversation. `default.tsx` already returns null for
 * the soft-nav fallback; this guard handles direct navigation +
 * deep-links where searchParams are populated.
 */

import { loadConsoleKpis } from '@/lib/console-kpis';
import { requireCurrentTenant } from '@/lib/tenant-context';

export const dynamic = 'force-dynamic';

interface KpisSlotProps {
  searchParams: Promise<{ tripId?: string }>;
}

export default async function KpisSlot({ searchParams }: KpisSlotProps) {
  const params = await searchParams;
  if (params.tripId) return null;

  const { tenant } = await requireCurrentTenant();
  const kpis = await loadConsoleKpis(tenant.id);

  return (
    <div className="border-b border-[color:var(--surface-border,rgba(0,0,0,0.08))] bg-[color:var(--surface-raised,#fff)]/60 px-4 py-3 backdrop-blur-sm">
      <div className="grid grid-cols-3 gap-0 sm:grid-cols-5">
        <KpiCell
          label="In flight"
          big={String(kpis.inFlightCount)}
          sub={`${kpis.inFlightCount === 1 ? 'trip' : 'trips'} · ${kpis.awaitingCount} awaiting`}
          divider
        />
        <KpiCell
          label="Awaiting"
          big={String(kpis.awaitingCount)}
          sub="approval queue"
          divider
          hideOnSm
        />
        <KpiCell
          label="Settled 30d"
          big={kpis.settled30dCount > 0 ? String(kpis.settled30dCount) : '—'}
          sub={kpis.settled30dFare ?? 'awaiting roll-up'}
          divider
        />
        <KpiCell
          label="Total fare 30d"
          big={kpis.settled30dFare ?? '—'}
          sub="confirmed + ticketed"
          divider
          hideOnSm
        />
        <KpiCell label="Avg response" big={kpis.avgResponseLabel ?? '—'} sub="agent latency" />
      </div>
    </div>
  );
}

function KpiCell({
  label,
  big,
  sub,
  divider,
  hideOnSm,
}: {
  label: string;
  big: string;
  sub: string;
  divider?: boolean;
  hideOnSm?: boolean;
}) {
  return (
    <div
      className={`flex flex-col gap-0.5 px-3 ${
        divider ? 'border-r border-[color:var(--surface-border,rgba(0,0,0,0.08))]' : ''
      } ${hideOnSm ? 'hidden sm:flex' : ''}`}
    >
      <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[color:var(--surface-muted,#888)]">
        {label}
      </span>
      <span className="font-mono text-lg font-semibold tabular-nums leading-none">{big}</span>
      <span className="text-[10px] text-[color:var(--surface-muted,#888)]">{sub}</span>
    </div>
  );
}
