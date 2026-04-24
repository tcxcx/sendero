'use client';

/**
 * FooterNumbers — Awwwards-grade animated readouts for the footer rail.
 *
 * Two strategies, picked for the data shape:
 *
 *   <DigitTicker>     Per-digit vertical slide (0-9 column translated
 *                     into view). Used for monotonically advancing
 *                     integers like the block number — only the digits
 *                     that actually changed move, the rest stay still.
 *                     Cheap, deterministic, no spring overshoot.
 *
 *   <SmoothNumber>    Tightly tuned spring around our existing
 *                     AnimatedNumber. Tuned for sub-second cadence —
 *                     stiffer + heavier damping than the editorial
 *                     default so it settles before the next tick lands.
 *
 * Both honor `prefers-reduced-motion`: tickers snap to the next value,
 * SmoothNumber inherits the parent component's reduced behavior.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import { motion } from 'motion/react';
import { AnimatedNumber } from '@sendero/ui/animated-number';

const DIGIT_HEIGHT_EM = 1.1;
const DIGIT_DURATION_S = 0.42;
const DIGIT_EASE = [0.22, 1, 0.36, 1] as const; // ease-out-quart, no overshoot

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return reduced;
}

/* ─── DigitTicker ──────────────────────────────────────────────────────── */

interface DigitTickerProps {
  /** The integer to display. Bigints are fine; strings of digits are fine. */
  value: number | bigint | string;
  /** Optional minimum width in chars (e.g. 8 → "00038830355"-style padding). */
  minDigits?: number;
  /** Optional className for the wrapper. */
  className?: string;
}

export function DigitTicker({ value, minDigits, className }: DigitTickerProps) {
  const raw = String(value).replace(/[^0-9]/g, '');
  const padded = minDigits ? raw.padStart(minDigits, '0') : raw;
  const digits = padded.split('');
  const reduced = usePrefersReducedMotion();

  return (
    <span
      className={className}
      style={{
        fontVariantNumeric: 'tabular-nums',
        display: 'inline-flex',
        alignItems: 'baseline',
      }}
      aria-label={padded}
    >
      {digits.map((d, i) => (
        <Digit key={`pos-${digits.length - i}`} value={d} reduced={reduced} />
      ))}
    </span>
  );
}

function Digit({ value, reduced }: { value: string; reduced: boolean }) {
  // Non-numeric (commas, periods) renders statically.
  if (!/^[0-9]$/.test(value)) {
    return <span aria-hidden="true">{value}</span>;
  }

  const n = Number(value);

  // Track previous digit so we can pick the shortest visual path. For a
  // monotonically increasing counter (block number) the "next" digit
  // wraps 9→0 — sliding *down* through 0-9 reads more naturally than
  // jumping back to the top.
  const prevRef = useRef<number | null>(null);
  useEffect(() => {
    prevRef.current = n;
  }, [n]);

  return (
    <span
      style={{
        position: 'relative',
        display: 'inline-block',
        width: '1ch',
        height: `${DIGIT_HEIGHT_EM}em`,
        overflow: 'hidden',
        verticalAlign: 'baseline',
        lineHeight: `${DIGIT_HEIGHT_EM}em`,
      }}
    >
      <motion.span
        style={{ display: 'block', willChange: 'transform' }}
        initial={false}
        animate={{ y: `-${n * DIGIT_HEIGHT_EM}em` }}
        transition={
          reduced
            ? { duration: 0 }
            : {
                duration: DIGIT_DURATION_S,
                ease: [...DIGIT_EASE] as [number, number, number, number],
              }
        }
      >
        {Array.from({ length: 10 }, (_, i) => (
          <span
            key={i}
            style={{
              display: 'block',
              height: `${DIGIT_HEIGHT_EM}em`,
              lineHeight: `${DIGIT_HEIGHT_EM}em`,
              textAlign: 'center',
            }}
          >
            {i}
          </span>
        ))}
      </motion.span>
    </span>
  );
}

/* ─── SmoothNumber — spring-driven for fractional / monetary values ───── */

interface SmoothNumberProps {
  value: number;
  precision?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
  /** "fast" = sub-second updates (gas, calls). "calm" = slower data (balance). */
  cadence?: 'fast' | 'calm';
}

export function SmoothNumber({
  value,
  precision = 0,
  prefix,
  suffix,
  className,
  cadence = 'calm',
}: SmoothNumberProps) {
  // fast: settles in ~250ms, no overshoot; calm: editorial settle (~600ms).
  const tuning = useMemo(
    () =>
      cadence === 'fast'
        ? { mass: 0.5, stiffness: 220, damping: 28 }
        : { mass: 0.8, stiffness: 90, damping: 16 },
    [cadence]
  );

  return (
    <AnimatedNumber
      value={value}
      precision={precision}
      prefix={prefix}
      suffix={suffix}
      className={className}
      mass={tuning.mass}
      stiffness={tuning.stiffness}
      damping={tuning.damping}
    />
  );
}
