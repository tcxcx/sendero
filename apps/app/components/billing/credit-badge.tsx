/**
 * Credit burn-down meter — "retrospective consumed credits this cycle"
 * per the autoplan Design subagent's CRITICAL trust-risk fix.
 *
 * This component shows REAL CONSUMED credits (Subscription.meterBalanceMicro
 * decremented by preflight on each turn), NOT a predictive `~$/turn ×
 * estimated turns` calculation. The number can never be a "lie" because
 * it's a sum of what already happened, not a forecast.
 *
 * Two variants:
 *
 * - **compact**: pill suitable for `/dashboard` header. Mono dollar
 *   amount + small bar. Designed to fit beside the model picker
 *   (~140px wide).
 *
 * - **full**: settings-card variant for `/dashboard/settings/billing`.
 *   Headline + bar + days-until-renewal + daily-cap callout.
 *
 * Color thresholds use the actual Sendero design tokens (per the Design
 * subagent's correction — `--ink` is vermillion, `--midnight` is the
 * warm charcoal/navy used for body text). Numerals always render in
 * `--midnight` so contrast holds even on the alert states (which only
 * shift the bar fill, not the text).
 *
 * - 0–60% consumed   — `--midnight` (calm; "on track")
 * - 60–85% consumed  — `--sand`     (warning; trend visible)
 * - 85–100% consumed — `--ink`      (vermillion; cap approaching)
 *
 * Server component. No interactivity in v1. Tooltip + breakdown
 * popover live behind a future client wrapper.
 */

import { currentCreditUsage, type CurrentCreditUsage } from '@/lib/billing-plan';

interface Props {
  /** `compact` for header pills, `full` for the settings card. */
  variant?: 'compact' | 'full';
}

function formatUsd(micro: bigint): string {
  // Two-decimal USD without rounding artifacts: divide bigint by
  // 10_000n (cents) then format with `Intl`.
  const cents = Number(micro / 10_000n);
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function daysUntil(date: Date | null): number | null {
  if (!date) return null;
  const ms = date.getTime() - Date.now();
  if (ms <= 0) return 0;
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

function fillToken(consumed: number): { fill: string; label: string } {
  if (consumed >= 0.85) return { fill: 'var(--ink)', label: 'cap-approaching' };
  if (consumed >= 0.6) return { fill: 'var(--sand)', label: 'trending-warm' };
  return { fill: 'var(--midnight)', label: 'on-track' };
}

export async function CreditBadge({ variant = 'compact' }: Props) {
  const usage = await currentCreditUsage();
  // Free tier or any tenant without a credit grant — render nothing.
  // The picker on its own carries the "Add for $19/mo" upsell story.
  if (usage.monthlyGrantMicro === null || usage.balanceMicro === null) {
    return null;
  }
  if (variant === 'compact') {
    return <CompactPill usage={usage} />;
  }
  return <FullCard usage={usage} />;
}

function CompactPill({ usage }: { usage: CurrentCreditUsage }) {
  // Type narrowing — the parent already proved these are non-null.
  const consumed = usage.consumedMicro!;
  const grant = usage.monthlyGrantMicro!;
  const fraction = usage.consumedFraction ?? 0;
  const { fill, label } = fillToken(fraction);
  const widthPct = Math.round(fraction * 100);

  return (
    <div
      className="inline-flex items-center gap-2 rounded-md border border-[color:var(--hairline-color-soft)] bg-[color:var(--surface-raised)] px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.06em] text-[color:var(--midnight)]"
      aria-label={`Credit usage ${formatUsd(consumed)} of ${formatUsd(grant)}, ${label}`}
    >
      <div
        aria-hidden
        className="h-1 w-12 overflow-hidden rounded-full"
        style={{ background: 'color-mix(in oklab, var(--midnight) 8%, transparent)' }}
      >
        <div
          className="h-full transition-[width] duration-200"
          style={{ width: `${widthPct}%`, background: fill }}
        />
      </div>
      <span>
        {formatUsd(consumed)} / {formatUsd(grant)}
      </span>
    </div>
  );
}

function FullCard({ usage }: { usage: CurrentCreditUsage }) {
  const consumed = usage.consumedMicro!;
  const grant = usage.monthlyGrantMicro!;
  const balance = usage.balanceMicro!;
  const fraction = usage.consumedFraction ?? 0;
  const { fill, label } = fillToken(fraction);
  const widthPct = Math.round(fraction * 100);
  const days = daysUntil(usage.currentPeriodEnd);

  // Daily callout — only render if a daily cap is set AND non-trivial
  // burn has happened. Avoids a "$0 of $1.25 today" line on a fresh
  // cycle.
  const showDaily =
    usage.dailyCapMicro !== null &&
    usage.dailyConsumedMicro !== null &&
    usage.dailyConsumedMicro > 0n;

  return (
    <div
      className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-[color:var(--hairline-color-soft)] bg-[color:var(--surface-raised)] p-4"
      aria-label={`Credit usage ${formatUsd(consumed)} of ${formatUsd(grant)} this cycle, ${label}`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex flex-col">
          <span
            className="font-mono text-[10px] uppercase tracking-[0.08em] text-[color:color-mix(in_oklab,var(--midnight)_60%,transparent)]"
          >
            Metered usage this cycle
          </span>
          <span className="text-[20px] font-medium text-[color:var(--midnight)]">
            {formatUsd(consumed)}{' '}
            <span className="text-[color:color-mix(in_oklab,var(--midnight)_55%,transparent)]">
              of {formatUsd(grant)}
            </span>
          </span>
        </div>
        <div
          className="font-mono text-[10px] uppercase tracking-[0.08em] text-[color:color-mix(in_oklab,var(--midnight)_55%,transparent)]"
        >
          {days === null
            ? 'this cycle'
            : days === 0
              ? 'resets today'
              : `resets in ${days} day${days === 1 ? '' : 's'}`}
        </div>
      </div>
      <div
        aria-hidden
        className="h-2 w-full overflow-hidden rounded-full"
        style={{ background: 'color-mix(in oklab, var(--midnight) 8%, transparent)' }}
      >
        <div
          className="h-full transition-[width] duration-200"
          style={{ width: `${widthPct}%`, background: fill }}
        />
      </div>
      <div className="flex items-center justify-between gap-3 font-mono text-[10px] uppercase tracking-[0.08em] text-[color:color-mix(in_oklab,var(--midnight)_60%,transparent)]">
        <span>{formatUsd(balance)} remaining</span>
        {showDaily ? (
          <span>
            {formatUsd(usage.dailyConsumedMicro!)} / {formatUsd(usage.dailyCapMicro!)} today
          </span>
        ) : null}
      </div>
    </div>
  );
}
