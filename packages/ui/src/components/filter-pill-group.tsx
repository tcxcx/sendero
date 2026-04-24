'use client';

/**
 * FilterPillGroup — Handle-style calm filter row (DESIGN.md §19).
 *
 * Each pill is rounded-full, `--surface-raised` fill, `--hairline-soft`
 * border, midnight-at-70% label. Hover raises to `--shadow-xs`. No
 * solid-black anywhere. Slots:
 *   - `search`: rounded-full search input with a glyph on the left.
 *   - `children`: the dropdown / date-range / action pills.
 *
 * Exports `FilterPill` (plain pill button/label), `FilterDropdown`
 * (chevron pill), and `FilterSearch` (input pill) as compositional
 * primitives so callers can mix them without reimplementing chrome.
 */

import type { HTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

import { CalendarIcon, ChevronDownIcon, SearchIcon } from 'lucide-react';

import { cn } from '../utils/cn';

export interface FilterPillGroupProps {
  search?: ReactNode;
  children?: ReactNode;
  className?: string;
  ariaLabel?: string;
}

export function FilterPillGroup({ search, children, className, ariaLabel }: FilterPillGroupProps) {
  return (
    <div
      aria-label={ariaLabel}
      className={cn(
        'flex flex-wrap items-center gap-3 bg-[color:var(--surface-base)] py-2',
        className
      )}
    >
      {search}
      {children}
    </div>
  );
}

const pillBase =
  'inline-flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-medium text-[color:color-mix(in_oklab,var(--sendero-midnight,#1f2a44)_70%,transparent)] bg-[color:var(--surface-raised)] shadow-[var(--shadow-xs)] transition-[box-shadow,background-color] duration-[160ms] ease-[cubic-bezier(0.23,1,0.32,1)] hover:shadow-[var(--shadow-sm)] hover:text-foreground';
const pillBorder = { border: 'var(--hairline-soft)' } as const;

export function FilterPill({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" style={pillBorder} className={cn(pillBase, className)} {...props}>
      {children}
    </button>
  );
}

export interface FilterDropdownProps extends HTMLAttributes<HTMLButtonElement> {
  label: string;
  caret?: boolean;
}

export function FilterDropdown({
  label,
  caret = true,
  className,
  ...props
}: FilterDropdownProps) {
  return (
    <button type="button" style={pillBorder} className={cn(pillBase, className)} {...props}>
      <span>{label}</span>
      {caret ? <ChevronDownIcon className="size-3.5 opacity-70" /> : null}
    </button>
  );
}

export interface FilterDateRangeProps extends HTMLAttributes<HTMLButtonElement> {
  label: string;
}

export function FilterDateRange({ label, className, ...props }: FilterDateRangeProps) {
  return (
    <button type="button" style={pillBorder} className={cn(pillBase, className)} {...props}>
      <CalendarIcon className="size-3.5 opacity-70" />
      <span>{label}</span>
    </button>
  );
}

export interface FilterSearchProps extends InputHTMLAttributes<HTMLInputElement> {
  containerClassName?: string;
}

export function FilterSearch({ containerClassName, className, ...props }: FilterSearchProps) {
  return (
    <div
      style={pillBorder}
      className={cn(
        'inline-flex items-center gap-2 rounded-full bg-[color:var(--surface-raised)] px-4 py-2 shadow-[var(--shadow-xs)] transition-[box-shadow] duration-[160ms] focus-within:shadow-[var(--shadow-sm)]',
        containerClassName
      )}
    >
      <SearchIcon className="size-3.5 opacity-60" aria-hidden="true" />
      <input
        type="search"
        className={cn(
          'w-full border-0 bg-transparent p-0 text-[13px] placeholder:text-[color:color-mix(in_oklab,var(--sendero-midnight,#1f2a44)_40%,transparent)] focus:outline-none',
          className
        )}
        {...props}
      />
    </div>
  );
}
