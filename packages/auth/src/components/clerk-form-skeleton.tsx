'use client';

import { useEffect, useState } from 'react';

type ClerkFormSkeletonProps = {
  className?: string;
};

/**
 * ClerkFormSkeleton — static, editorial placeholder that matches the
 * footprint of a loaded Clerk sign-in / sign-up / waitlist card.
 *
 * Design goals:
 * - Zero CLS. Width `max-w-[440px]`, min-height ~560px so the skeleton and
 *   the real Clerk card share the same box.
 * - No shimmer, no glitch. Calm, editorial. Just muted ink bars, a single
 *   status dot (s-pulse-dot), and a soft s-fade entry.
 * - The "Taking longer than usual…" note stays invisible for 4s so a fast
 *   mount never reads as an error state.
 */
function ClerkFormSkeleton({ className }: ClerkFormSkeletonProps) {
  const [showSlowNote, setShowSlowNote] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setShowSlowNote(true), 4000);
    return () => clearTimeout(id);
  }, []);

  const barClass = 'h-[44px] rounded-sm bg-[color-mix(in_oklab,var(--ink)_6%,transparent)]';
  const smallBarClass = 'h-3 rounded-sm bg-[color-mix(in_oklab,var(--ink)_6%,transparent)]';

  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className={[
        's-fade',
        'relative w-full max-w-[440px] min-h-[560px]',
        'border border-[var(--border)] bg-[var(--bg-elev)] p-6',
        'flex flex-col gap-5 text-[var(--text)]',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {/* Header row: eyebrow + pulse dot */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <p className="m-0 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--ink)]">
            Secure identity
          </p>
          <div
            className="h-5 w-40 rounded-sm bg-[color-mix(in_oklab,var(--ink)_6%,transparent)]"
            aria-hidden="true"
          />
        </div>
        <span
          className="s-pulse-dot mt-1 inline-block size-2 rounded-full bg-[var(--ink)]"
          aria-hidden="true"
        />
      </div>

      {/* Input rows */}
      <div className="flex flex-col gap-3">
        <div className={barClass} aria-hidden="true" />
        <div className={barClass} aria-hidden="true" />
      </div>

      {/* CTA bar */}
      <div
        className="h-[44px] rounded-sm bg-[color-mix(in_oklab,var(--ink)_12%,transparent)]"
        aria-hidden="true"
      />

      {/* Divider */}
      <div className="h-px w-full bg-[var(--border)]" aria-hidden="true" />

      {/* Two small text rows (footer copy placeholder) */}
      <div className="flex flex-col gap-2">
        <div className={`${smallBarClass} w-3/4`} aria-hidden="true" />
        <div className={`${smallBarClass} w-1/2`} aria-hidden="true" />
      </div>

      {/* Delayed "taking longer than usual" note. Opacity only; invisible
          at t=0 so a normal mount never flashes it. */}
      <p
        className="m-0 mt-auto font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--text-dim)] transition-opacity duration-500"
        style={{ opacity: showSlowNote ? 1 : 0 }}
      >
        Taking longer than usual…
      </p>
    </div>
  );
}

export { ClerkFormSkeleton };
export default ClerkFormSkeleton;
