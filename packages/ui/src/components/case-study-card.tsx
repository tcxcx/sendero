'use client';

/**
 * CaseStudyCard — split 1fr/1fr card, columns meet at a hairline,
 * outer border + radius, overflow hidden (DESIGN.md §19).
 *
 * - Left column: 48px padding, vertical flex, justify-between.
 *   "CASE STUDY" eyebrow pill uses hairline border, tiny small-caps.
 * - Right column: image fills. On card hover, the image scales to
 *   1.02 over 400ms.
 * - Whole card elevates to `--shadow-md` on hover.
 *
 * Use with the postcard series for chain-of-action storytelling.
 */

import type { ReactNode } from 'react';

import { cn } from '../utils/cn';

export interface CaseStudyCardProps {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  image: ReactNode;
  className?: string;
}

export function CaseStudyCard({
  eyebrow = 'Case study',
  title,
  description,
  footer,
  image,
  className,
}: CaseStudyCardProps) {
  return (
    <article
      style={{ border: 'var(--hairline)' }}
      className={cn(
        'group relative grid overflow-hidden rounded-[var(--radius-lg)] transition-[box-shadow] duration-[240ms] ease-[cubic-bezier(0.23,1,0.32,1)] hover:shadow-[var(--shadow-md)]',
        'grid-cols-1 md:grid-cols-2',
        className
      )}
    >
      {/* Left column */}
      <div
        className="flex flex-col justify-between gap-10 p-10 md:p-12"
        style={{
          borderRight: 'var(--hairline)',
          background: 'var(--surface-raised)',
        }}
      >
        <div className="flex flex-col gap-4">
          <span
            className="inline-flex w-fit items-center rounded-full px-3 py-1 font-mono uppercase"
            style={{
              border: 'var(--hairline)',
              fontSize: 'var(--label-meta)',
              letterSpacing: 'var(--label-meta-tracking)',
              color:
                'color-mix(in oklab, var(--sendero-midnight, #1f2a44) 60%, transparent)',
            }}
          >
            {eyebrow}
          </span>
          <h3 className="text-[22px] font-semibold leading-tight text-foreground md:text-[28px]">
            {title}
          </h3>
          {description ? (
            <p className="max-w-[52ch] text-[15px] leading-[1.6] text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {footer ? <div className="mt-auto">{footer}</div> : null}
      </div>
      {/* Right column — postcard / image */}
      <div className="relative overflow-hidden bg-[color:var(--surface-base)]">
        <div className="h-full w-full transition-transform duration-[400ms] ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:scale-[1.02]">
          {image}
        </div>
      </div>
    </article>
  );
}
