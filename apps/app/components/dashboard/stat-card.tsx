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

import { SmoothNumber } from '@/components/footer-numbers';

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
        'group flex flex-col gap-2 rounded-[var(--radius-lg)] bg-white px-5 py-4 ' +
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
      <div className="flex items-end justify-between gap-3">
        <StatValue raw={value} numeric={numeric} />
        <Link
          href={href}
          className={
            'inline-flex shrink-0 items-center gap-1 rounded-full ' +
            'bg-[color:var(--ink)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] ' +
            'text-white shadow-[0_1px_2px_rgba(31,42,68,0.12),0_4px_12px_rgba(31,42,68,0.08),inset_0_1px_0_rgba(255,255,255,0.22)] ' +
            'transition-[background-color,box-shadow,transform] duration-[160ms] ' +
            'hover:bg-[color:color-mix(in_oklab,var(--ink)_92%,black)] ' +
            'hover:shadow-[0_2px_4px_rgba(31,42,68,0.14),0_8px_18px_rgba(31,42,68,0.12),inset_0_1px_0_rgba(255,255,255,0.24)] ' +
            'hover:-translate-y-px'
          }
        >
          View
          <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" className="-mr-0.5">
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
      {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
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
      <SmoothNumber value={numeric} precision={precision} prefix={prefix} cadence="calm" />
    </div>
  );
}

function parseStatValue(raw: string): number | null {
  const cleaned = raw.replace(/[,\s]/g, '').replace(/^[^\d.-]+/, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
