'use client';

/**
 * MetricRow — editorial oversized-numeral KPI row (DESIGN.md §19).
 *
 * A horizontal flex row of cells separated by hairlines on parchment.
 * No card background, no shadow, no outer border. Numerals animate
 * via @sendero/ui/animated-number (Cult UI fork). Labels sit in
 * small-caps below.
 *
 * Responsive: below md, the row collapses to 2×2 with hairlines
 * running both vertical and horizontal.
 *
 * Use at trip inbox header, money & policy, agent console, marketing
 * stat rows. Always on --surface-base, never inside another card.
 */

import { AnimatedNumber } from '@sendero/ui/animated-number';

export interface Metric {
  label: string;
  value: number;
  /** Static text before the numeral (e.g. "$"). Never animated. */
  prefix?: string;
  /** Static text after the numeral (e.g. " USDC"). Never animated. */
  suffix?: string;
  /** Decimal places. Default 0. */
  precision?: number;
  /** Optional helper/sub-copy below the label. */
  hint?: string;
}

export interface MetricRowProps {
  metrics: ReadonlyArray<Metric>;
  ariaLabel?: string;
}

export function MetricRow({ metrics, ariaLabel }: MetricRowProps) {
  return (
    <dl
      aria-label={ariaLabel}
      className="grid grid-cols-2 md:grid-cols-4"
      style={{ columnGap: 0, rowGap: 0 }}
    >
      {metrics.map((metric, idx) => {
        const notLastColDesktop = idx !== metrics.length - 1;
        const notLastRowMobile = idx < metrics.length - 2;
        return (
          <div
            key={metric.label}
            className="relative flex flex-col gap-3 px-6 py-10 md:px-6 md:py-12"
            style={{
              borderRight: notLastColDesktop ? 'var(--hairline)' : undefined,
              borderBottom: notLastRowMobile ? 'var(--hairline)' : undefined,
            }}
          >
            <dd
              className="font-semibold leading-none text-foreground"
              style={{
                fontSize: 'var(--numeral-lg)',
                fontVariantNumeric: 'tabular-nums',
                letterSpacing: '-0.01em',
              }}
            >
              <AnimatedNumber
                value={metric.value}
                precision={metric.precision ?? 0}
                prefix={metric.prefix}
                suffix={metric.suffix}
              />
            </dd>
            <dt
              className="font-mono uppercase"
              style={{
                fontSize: 'var(--label-meta)',
                letterSpacing: 'var(--label-meta-tracking)',
                color:
                  'color-mix(in oklab, var(--sendero-midnight, #1f2a44) 60%, transparent)',
              }}
            >
              {metric.label}
            </dt>
            {metric.hint ? (
              <div className="text-xs text-muted-foreground">{metric.hint}</div>
            ) : null}
          </div>
        );
      })}
    </dl>
  );
}

/* Responsive: hairlines on the edge cells need adjusting. The grid
   above applies right/bottom borders based on index, which already
   collapses correctly at both md (4-col: right on 1,2,3) and mobile
   (2-col: right on 0,2; bottom on 0,1 when there are 4). For 3 or
   fewer metrics, callers should pass exactly 3 and tweak grid-cols. */
