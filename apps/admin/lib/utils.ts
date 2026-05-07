import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * shadcn's canonical class-name combinator. Merges tailwind classes
 * intelligently so later utilities win over earlier ones (e.g.
 * `cn('bg-red-500', 'bg-blue-500')` → `'bg-blue-500'`). Used by every
 * shadcn primitive ported into this app.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
