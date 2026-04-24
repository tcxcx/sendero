'use client';

/**
 * StatCard — dashboard KPI block. Borderless raised card on parchment
 * (DESIGN.md §7 + §19) with an editorial numeral headliner that counts
 * up on mount via `useCountUp()`.
 *
 * - Borderless (`--surface-raised` + `--shadow-md`), lifts to
 *   `--shadow-lg` on hover over 240ms.
 * - Value uses the `--numeral-lg` scale, tabular-nums, serif weight
 *   when the family supports it.
 * - Currency formats fade in instead of counting up (DESIGN.md §13.1 —
 *   mid-animation format jumps look cheap).
 * - Respects `prefers-reduced-motion` via the hook.
 */

import Link from 'next/link';

import { useCountUp } from '@/hooks/use-count-up';

export function StatCard({
  title,
  value,
  description,
  href,
}: {
  title: string;
  value: string;
  description?: string;
  href: string;
}) {
  // Parseable numeric? Strip currency/commas and try to count up.
  const numeric = parseStatValue(value);

  return (
    <div
      className={
        'group flex flex-col gap-3 rounded-[var(--radius-lg)] bg-[color:var(--surface-raised)] px-5 py-5 ' +
        'shadow-[var(--shadow-md)] transition-[box-shadow] duration-[240ms] ease-[cubic-bezier(0.23,1,0.32,1)] ' +
        'hover:shadow-[var(--shadow-lg)]'
      }
    >
      <div
        className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground"
        style={{ letterSpacing: 'var(--label-meta-tracking, 0.12em)' }}
      >
        {title}
      </div>
      <StatValue raw={value} numeric={numeric} />
      {description ? (
        <p className="text-sm text-muted-foreground">{description}</p>
      ) : null}
      <Link
        href={href}
        className={
          'mt-auto inline-flex w-fit items-center gap-1 rounded-full ' +
          'bg-[color:var(--tint-midnight-soft)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] ' +
          'text-[color:var(--text)] transition-[background-color,box-shadow] duration-[160ms] ' +
          'hover:bg-[color:var(--tint-midnight-medium)]'
        }
      >
        View
        <svg
          viewBox="0 0 24 24"
          width="12"
          height="12"
          aria-hidden="true"
          className="-mr-0.5"
        >
          <path
            d="M5 12h14m0 0l-5-5m5 5l-5 5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </Link>
    </div>
  );
}

function StatValue({ raw, numeric }: { raw: string; numeric: number | null }) {
  if (numeric === null) {
    return (
      <div
        className="text-[length:var(--numeral-md)] font-semibold leading-none tabular-nums text-foreground"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {raw}
      </div>
    );
  }
  return <AnimatedNumeral raw={raw} target={numeric} />;
}

function AnimatedNumeral({ raw, target }: { raw: string; target: number }) {
  const value = useCountUp(target, { durationMs: 640 });
  const hasCurrency = /[$€£]/.test(raw);
  const hasDecimals = /\.\d+/.test(raw);
  const rendered = hasCurrency
    ? formatCurrency(raw, value)
    : hasDecimals
      ? value.toFixed(2)
      : Math.round(value).toLocaleString();
  return (
    <div
      className="text-[length:var(--numeral-md)] font-semibold leading-none tabular-nums text-foreground"
      style={{ fontVariantNumeric: 'tabular-nums' }}
    >
      {rendered}
    </div>
  );
}

function parseStatValue(raw: string): number | null {
  const cleaned = raw.replace(/[,\s]/g, '').replace(/^[^\d.-]+/, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function formatCurrency(template: string, value: number): string {
  const match = template.match(/^([^\d.-]+)/);
  const prefix = match ? match[1] : '';
  const hasDecimals = /\.\d+/.test(template);
  const body = hasDecimals
    ? value.toFixed(2)
    : Math.round(value).toLocaleString();
  return `${prefix}${body}`;
}
