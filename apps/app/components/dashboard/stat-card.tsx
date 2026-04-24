'use client';

/**
 * StatCard — dashboard KPI block. Borderless raised card on parchment
 * (DESIGN.md §7 + §19) with an editorial numeral headliner animated
 * by @sendero/ui/animated-number (spring physics, not rAF easing).
 *
 * - Borderless (`--surface-raised` + `--shadow-md`), lifts to
 *   `--shadow-lg` on hover over 240ms.
 * - Value uses the `--numeral-md` scale, tabular-nums.
 * - Currency symbols render as a static `prefix` on AnimatedNumber
 *   so the glyph never flickers mid-animation (DESIGN.md §13.1).
 * - Reduced-motion: AnimatedNumber jumps to the target instantly.
 */

import Link from 'next/link';

import { AnimatedNumber } from '@sendero/ui/animated-number';

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
        className="text-[length:var(--numeral-md)] font-semibold leading-none text-foreground"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {raw}
      </div>
    );
  }
  // Split the displayed string into a static prefix (currency glyph,
  // etc.) and the numeric body. AnimatedNumber animates only the body
  // so the currency glyph never flickers.
  const match = raw.match(/^([^\d.-]+)/);
  const prefix = match ? match[1] : undefined;
  const precision = /\.\d+/.test(raw) ? 2 : 0;

  return (
    <div
      className="text-[length:var(--numeral-md)] font-semibold leading-none text-foreground"
      style={{ fontVariantNumeric: 'tabular-nums' }}
    >
      <AnimatedNumber value={numeric} precision={precision} prefix={prefix} />
    </div>
  );
}

function parseStatValue(raw: string): number | null {
  const cleaned = raw.replace(/[,\s]/g, '').replace(/^[^\d.-]+/, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
