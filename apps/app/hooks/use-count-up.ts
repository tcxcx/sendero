'use client';

/**
 * useCountUp — animates a numeric value from 0 to `target` over a
 * configurable duration. Implemented via requestAnimationFrame so it
 * interpolates continuously instead of stepping through CSS keyframes
 * (which looks cheap on large display numerals).
 *
 * Respects `prefers-reduced-motion`: settles immediately at the target
 * value, no interpolation.
 *
 * Easing defaults to Sendero's cubic-bezier(0.23, 1, 0.32, 1) — the
 * same curve DESIGN.md §5 calls for on entrances and feedback.
 */

import { useEffect, useRef, useState } from 'react';

export interface UseCountUpOptions {
  /** Milliseconds to animate from 0 → target. Default 600ms. */
  durationMs?: number;
  /**
   * Easing function mapping `t` in [0, 1] to a progress in [0, 1].
   * Defaults to the Sendero ease-out curve.
   */
  ease?: (t: number) => number;
  /** If true, skip the animation and settle at the target immediately. */
  disabled?: boolean;
}

// cubic-bezier(0.23, 1, 0.32, 1) approximated as a power-ease-out.
const defaultEase = (t: number) => 1 - (1 - t) ** 3;

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function useCountUp(target: number, options: UseCountUpOptions = {}): number {
  const { durationMs = 600, ease = defaultEase, disabled = false } = options;
  const [value, setValue] = useState(() =>
    disabled || prefersReducedMotion() ? target : 0
  );
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);
  const fromRef = useRef(0);

  useEffect(() => {
    if (disabled || prefersReducedMotion()) {
      setValue(target);
      return;
    }
    fromRef.current = value;
    startRef.current = null;

    const step = (now: number) => {
      if (startRef.current === null) startRef.current = now;
      const elapsed = now - startRef.current;
      const t = Math.min(1, elapsed / durationMs);
      const eased = ease(t);
      setValue(fromRef.current + (target - fromRef.current) * eased);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      }
    };
    rafRef.current = requestAnimationFrame(step);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // intentionally omit `value` from deps — we only restart when the
    // target changes, and we capture the current value at start time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs, disabled]);

  return value;
}
