'use client';

/**
 * PillTabs — sliding-pill tab control (DESIGN.md §19, Pill Tab Controls).
 *
 * Labels sit in a row on the parchment field. Active tab is a SOLID
 * midnight pill with warm-white text; the active fill slides between
 * tabs via `motion.div` `layoutId` so the pill appears to glide into
 * place over 240ms on Sendero's ease-out curve. No container border,
 * no baseline underline.
 *
 * Vermillion is reserved for sidebar-nav active state + primary CTAs;
 * tabs use solid midnight to avoid diluting the brand color across
 * the app (DESIGN.md §8).
 *
 * Animation respects `prefers-reduced-motion` via the `motion` library.
 */

import { motion } from 'motion/react';

export interface PillTab<V extends string = string> {
  value: V;
  label: string;
  count?: number;
}

export interface PillTabsProps<V extends string = string> {
  tabs: ReadonlyArray<PillTab<V>>;
  value: V;
  onChange: (next: V) => void;
  /** Shared `layoutId` root. Needed when multiple PillTabs live on the page. */
  id?: string;
  /** Aria label for the tablist. */
  ariaLabel?: string;
}

export function PillTabs<V extends string = string>({
  tabs,
  value,
  onChange,
  id = 'pill-tabs',
  ariaLabel,
}: PillTabsProps<V>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="inline-flex items-center gap-1"
    >
      {tabs.map(tab => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            role="tab"
            aria-selected={active}
            type="button"
            onClick={() => onChange(tab.value)}
            className={
              'relative inline-flex items-center gap-1.5 rounded-[999px] px-4 py-2 text-[13px] font-medium leading-none transition-colors duration-[160ms] ease-[cubic-bezier(0.23,1,0.32,1)] ' +
              (active
                ? 'text-[color:var(--surface-floating)]'
                : 'text-[color:color-mix(in_oklab,var(--sendero-midnight,#1f2a44)_70%,transparent)] hover:bg-[color:var(--tint-midnight-soft)]')
            }
          >
            {active ? (
              <motion.span
                layoutId={`${id}-active-pill`}
                className="absolute inset-0 rounded-[999px] bg-[color:var(--sendero-midnight,#1f2a44)] shadow-[var(--shadow-xs)]"
                transition={{
                  type: 'spring',
                  stiffness: 420,
                  damping: 34,
                  mass: 0.8,
                }}
                aria-hidden="true"
              />
            ) : null}
            <span className="relative z-[1]">{tab.label}</span>
            {typeof tab.count === 'number' ? (
              <span
                className={
                  'relative z-[1] rounded-full px-1.5 py-0.5 font-mono text-[10px] tabular-nums ' +
                  (active
                    ? 'bg-[color:color-mix(in_oklab,var(--surface-floating)_18%,transparent)] text-[color:var(--surface-floating)]'
                    : 'bg-[color:var(--tint-midnight-soft)] text-[color:color-mix(in_oklab,var(--sendero-midnight,#1f2a44)_60%,transparent)]')
                }
              >
                {tab.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
