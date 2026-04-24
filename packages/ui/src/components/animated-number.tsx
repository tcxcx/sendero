'use client';

/**
 * AnimatedNumber — spring-driven counting animation.
 *
 * Forked from Cult UI (https://cult-ui.com/docs/components/animated-number,
 * under MIT). Sendero-specific changes:
 *
 *   1. Default spring tuned to our editorial rhythm (`mass 0.8 /
 *      stiffness 90 / damping 16`) — arrives with a small settle
 *      instead of Cult's heavier `75 / 15` defaults.
 *   2. Respects `prefers-reduced-motion`: when the OS asks for less
 *      motion, we settle at the target value on first render and skip
 *      spring re-runs on subsequent updates.
 *   3. A `prefix` / `suffix` pair that render as static `<span>`s
 *      alongside the animated numeral so currency symbols don't
 *      flicker mid-animation (DESIGN.md §13.1).
 *   4. Exposes `tabularNums` (default true) so the numeral sits on
 *      Sendero's data rhythm (`font-variant-numeric: tabular-nums`)
 *      without the caller remembering.
 *   5. Graceful SSR: the initial server render shows the formatted
 *      target value (no motion wrapper required for hydration).
 *
 * Drop-in replacement for the hand-rolled `useCountUp` hook.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import { motion, type MotionValue, useSpring, useTransform } from 'motion/react';

export interface AnimatedNumberProps {
  value: number;
  /** Spring mass. Sendero default: 0.8. */
  mass?: number;
  /** Spring stiffness. Sendero default: 90 (slightly snappier than Cult's 75). */
  stiffness?: number;
  /** Spring damping. Sendero default: 16 (slightly more settled). */
  damping?: number;
  /** Decimal places. Default 0. */
  precision?: number;
  /** Custom number formatter. Receives the current (interpolated) number. */
  format?: (n: number) => string;
  /** Static text prepended (e.g. "$"). Never animated — prevents flicker. */
  prefix?: string;
  /** Static text appended (e.g. " USDC"). Never animated. */
  suffix?: string;
  /** Apply `font-variant-numeric: tabular-nums`. Default true. */
  tabularNums?: boolean;
  /** Optional className on the outer wrapper. */
  className?: string;
  /** Fires when the spring starts animating toward a new target. */
  onAnimationStart?: () => void;
  /** Fires when the spring settles at the target. */
  onAnimationComplete?: () => void;
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function AnimatedNumber({
  value,
  mass = 0.8,
  stiffness = 90,
  damping = 16,
  precision = 0,
  format,
  prefix,
  suffix,
  tabularNums = true,
  className,
  onAnimationStart,
  onAnimationComplete,
}: AnimatedNumberProps) {
  // Freeze reduced-motion preference on first client render so the hook
  // order stays stable across re-renders.
  const [reduced] = useState(() => prefersReducedMotion());
  const initialRef = useRef(reduced ? value : 0);

  const spring = useSpring(initialRef.current, { mass, stiffness, damping });

  const fmt = useMemo(() => {
    if (format) return format;
    const nf = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: precision,
      maximumFractionDigits: precision,
    });
    return (n: number) => nf.format(n);
  }, [format, precision]);

  const display: MotionValue<string> = useTransform(spring, current => {
    const rounded = Number.parseFloat(current.toFixed(precision));
    return fmt(rounded);
  });

  useEffect(() => {
    if (reduced) {
      spring.jump(value);
      return;
    }
    onAnimationStart?.();
    spring.set(value);
    const unsubscribe = spring.on('change', () => {
      if (spring.get() === value) onAnimationComplete?.();
    });
    return () => {
      unsubscribe();
    };
  }, [spring, value, reduced, onAnimationStart, onAnimationComplete]);

  const style = tabularNums ? { fontVariantNumeric: 'tabular-nums' as const } : undefined;

  return (
    <span className={className} style={style}>
      {prefix ? <span aria-hidden="true">{prefix}</span> : null}
      <motion.span>{display}</motion.span>
      {suffix ? <span aria-hidden="true">{suffix}</span> : null}
    </span>
  );
}
