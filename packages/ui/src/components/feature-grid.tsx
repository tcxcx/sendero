'use client';

/**
 * FeatureGrid — Handle "pain points" grid adapted for Sendero
 * (DESIGN.md §19). Four columns, no gap, hairline divider between
 * cells. Each cell is a dotted-grid illustration + headline + body.
 *
 * On scroll into view, illustration stroke-draws stagger by 80ms.
 * Respects prefers-reduced-motion via the illustration's own hook.
 */

import type { ReactNode } from 'react';

import { cn } from '../utils/cn';

export interface FeatureCell {
  /** Illustration slot — usually a `<DotGridFrame><RouteCurve /></DotGridFrame>`. */
  illustration: ReactNode;
  title: string;
  description: ReactNode;
}

export interface FeatureGridProps {
  cells: ReadonlyArray<FeatureCell>;
  /** Columns at md+ breakpoints. Default 4. */
  columns?: 2 | 3 | 4;
  className?: string;
}

export function FeatureGrid({ cells, columns = 4, className }: FeatureGridProps) {
  const gridCols =
    columns === 4
      ? 'md:grid-cols-4'
      : columns === 3
        ? 'md:grid-cols-3'
        : 'md:grid-cols-2';
  return (
    <div
      className={cn(
        'grid grid-cols-1 sm:grid-cols-2',
        gridCols,
        className
      )}
    >
      {cells.map((cell, idx) => {
        const notLastCol = (idx + 1) % columns !== 0;
        const notLastRow = idx < cells.length - columns;
        return (
          <div
            key={cell.title}
            className="flex flex-col gap-6 p-8"
            style={{
              borderRight: notLastCol ? 'var(--hairline-soft)' : undefined,
              borderBottom: notLastRow ? 'var(--hairline-soft)' : undefined,
            }}
          >
            <div className="aspect-[3/2] w-full">{cell.illustration}</div>
            <h3 className="text-[18px] font-semibold leading-snug text-foreground">
              {cell.title}
            </h3>
            <p className="text-[15px] leading-[1.6] text-muted-foreground">
              {cell.description}
            </p>
          </div>
        );
      })}
    </div>
  );
}
