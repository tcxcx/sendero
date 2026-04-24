'use client';

/**
 * AgentCard — agent / capability catalog card (DESIGN.md §19).
 *
 * - Rounded `--radius-lg`, `--hairline` outer border, no shadow at rest.
 * - Illustration area: `--surface-raised`, dotted-grid at 40% opacity,
 *   56px vertical padding, illustration centered.
 * - Content area: 32px padding. Small-caps eyebrow pill (hairline
 *   border), title, description.
 * - Footer: either "Coming soon" (midnight 60% opacity) OR a solid
 *   midnight rounded-full CTA with ArrowRight. Vermillion stays
 *   reserved for primary sign-up / book actions — pass
 *   `primaryAction` to switch to vermillion.
 * - Hover: whole card elevates to `--shadow-md`. Illustration's own
 *   stroke-draw fires via IntersectionObserver.
 */

import type { ReactNode } from 'react';

import { ArrowRightIcon } from 'lucide-react';

import { cn } from '../utils/cn';

export type AgentCardStatus = 'beta' | 'enterprise' | 'coming_soon' | 'live' | 'custom';

export interface AgentCardProps {
  illustration: ReactNode;
  title: string;
  description: ReactNode;
  status?: AgentCardStatus;
  /** Override the status label. */
  statusLabel?: string;
  /** Primary CTA text. If omitted, shows "Coming soon" footer. */
  cta?: string;
  onCtaClick?: () => void;
  /** Use the vermillion CTA treatment (primary action). Default false (midnight). */
  primaryAction?: boolean;
  className?: string;
}

const STATUS_LABEL: Record<AgentCardStatus, string> = {
  beta: 'Beta',
  enterprise: 'Enterprise',
  coming_soon: 'Coming soon',
  live: 'Live',
  custom: '',
};

export function AgentCard({
  illustration,
  title,
  description,
  status,
  statusLabel,
  cta,
  onCtaClick,
  primaryAction = false,
  className,
}: AgentCardProps) {
  const label = statusLabel ?? (status ? STATUS_LABEL[status] : undefined);
  const hasCta = Boolean(cta);

  return (
    <article
      style={{ border: 'var(--hairline)' }}
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-[var(--radius-lg)] transition-[box-shadow] duration-[240ms] ease-[cubic-bezier(0.23,1,0.32,1)] hover:shadow-[var(--shadow-md)]',
        className
      )}
    >
      {/* Illustration area */}
      <div
        className="relative flex items-center justify-center px-6 py-14"
        style={{
          background: 'var(--surface-raised)',
          borderBottom: 'var(--hairline-soft)',
        }}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{ background: 'var(--dot-grid-pattern)', opacity: 0.4 }}
        />
        <div className="relative h-24 w-full max-w-[240px]">{illustration}</div>
      </div>
      {/* Content */}
      <div className="flex flex-col gap-3 p-8">
        {label ? (
          <span
            className="inline-flex w-fit items-center rounded-full px-2.5 py-0.5 font-mono uppercase"
            style={{
              border: 'var(--hairline)',
              fontSize: 'var(--label-meta)',
              letterSpacing: 'var(--label-meta-tracking)',
              color:
                'color-mix(in oklab, var(--sendero-midnight, #1f2a44) 60%, transparent)',
            }}
          >
            {label}
          </span>
        ) : null}
        <h3 className="text-[17px] font-semibold leading-snug text-foreground">{title}</h3>
        <p className="text-[14px] leading-[1.6] text-muted-foreground">{description}</p>
        <div className="mt-2">
          {hasCta ? (
            <button
              type="button"
              onClick={onCtaClick}
              className={
                'inline-flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-medium transition-[background-color,transform] duration-[160ms] ease-[cubic-bezier(0.23,1,0.32,1)] active:translate-y-[1px] ' +
                (primaryAction
                  ? 'bg-[color:var(--ink)] text-[color:var(--surface-floating)] hover:bg-[color:color-mix(in_oklab,var(--ink)_92%,black)]'
                  : 'bg-[color:var(--sendero-midnight,#1f2a44)] text-[color:var(--surface-floating)] hover:bg-[color:color-mix(in_oklab,var(--sendero-midnight,#1f2a44)_92%,black)]')
              }
            >
              <span>{cta}</span>
              <ArrowRightIcon className="size-3.5" aria-hidden="true" />
            </button>
          ) : (
            <span
              className="font-mono uppercase"
              style={{
                fontSize: 'var(--label-meta)',
                letterSpacing: 'var(--label-meta-tracking)',
                color:
                  'color-mix(in oklab, var(--sendero-midnight, #1f2a44) 60%, transparent)',
              }}
            >
              Coming soon
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
