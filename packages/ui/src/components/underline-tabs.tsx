'use client';

/**
 * UnderlineTabs — editorial tab bar for long settings / documentation
 * surfaces where pills feel too button-y (DESIGN.md §19, §5).
 *
 * - Plain text labels, no pill wrap.
 * - Active: midnight 100% + 2px solid vermillion line directly beneath,
 *   animated via motion `layoutId`.
 * - Inactive: midnight 60%.
 * - Baseline: `--hairline-soft` spanning the full row; the vermillion
 *   active line sits on top of that hairline.
 */

import { motion } from 'motion/react';

export interface UnderlineTab<V extends string = string> {
  value: V;
  label: string;
}

export interface UnderlineTabsProps<V extends string = string> {
  tabs: ReadonlyArray<UnderlineTab<V>>;
  value: V;
  onChange: (next: V) => void;
  id?: string;
  ariaLabel?: string;
}

export function UnderlineTabs<V extends string = string>({
  tabs,
  value,
  onChange,
  id = 'underline-tabs',
  ariaLabel,
}: UnderlineTabsProps<V>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="relative flex items-end gap-6"
      style={{ borderBottom: 'var(--hairline-soft)' }}
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
              'relative pb-3 pt-2 text-[13px] font-medium transition-colors duration-[160ms] ease-[cubic-bezier(0.23,1,0.32,1)] ' +
              (active
                ? 'text-foreground'
                : 'text-[color:color-mix(in_oklab,var(--sendero-midnight,#1f2a44)_60%,transparent)] hover:text-foreground')
            }
          >
            {tab.label}
            {active ? (
              <motion.span
                layoutId={`${id}-underline`}
                className="absolute left-0 right-0"
                style={{
                  bottom: '-1px',
                  height: '2px',
                  background: 'var(--ink)',
                }}
                transition={{
                  type: 'spring',
                  stiffness: 440,
                  damping: 36,
                  mass: 0.8,
                }}
                aria-hidden="true"
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
