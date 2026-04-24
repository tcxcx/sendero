'use client';

/**
 * DotGridFrame — 3:2 aspect container that sits behind each of the
 * seven dotted-grid micro-illustrations (DESIGN.md §19). Renders the
 * `--dot-grid-pattern` overlay at 30% opacity and the illustration
 * on top. No border; `--surface-raised` fill + `--radius-lg`.
 *
 * Interactive variant: pass `interactive` to elevate on hover. The
 * illustration's stroke-draw animation is independent (driven by the
 * useStrokeDraw hook via intersection observer).
 */

import type { ReactNode } from 'react';

export interface DotGridFrameProps {
  children: ReactNode;
  /** Elevate on hover. Default false (quieter). */
  interactive?: boolean;
  /** Dot-grid overlay opacity. Default 0.3. Agent cards use 0.4. */
  dotOpacity?: number;
  className?: string;
}

export function DotGridFrame({
  children,
  interactive = false,
  dotOpacity = 0.3,
  className,
}: DotGridFrameProps) {
  return (
    <div
      className={
        'relative aspect-[3/2] overflow-hidden rounded-[var(--radius-lg)] ' +
        'bg-[color:var(--surface-raised)] ' +
        (interactive
          ? 'transition-[box-shadow] duration-[240ms] ease-[cubic-bezier(0.23,1,0.32,1)] shadow-[var(--shadow-md)] hover:shadow-[var(--shadow-lg)] '
          : 'shadow-[var(--shadow-xs)] ') +
        (className ?? '')
      }
    >
      {/* Dot-grid overlay */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background: 'var(--dot-grid-pattern)',
          opacity: dotOpacity,
        }}
      />
      {/* Illustration — centered with generous breathing room */}
      <div className="absolute inset-0 flex items-center justify-center p-6">
        {children}
      </div>
    </div>
  );
}
