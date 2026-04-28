'use client';

/**
 * Marketing-app local copy of the canonical hook from
 * `@sendero/ui/hooks/use-click-outside`. Kept in this directory only
 * because the morphing-dialog primitives in this folder import it as
 * a relative path (matches the upstream Midday motion-primitives
 * convention). Both implementations stay in lockstep — if you patch
 * one, mirror the other.
 */

import { type RefObject, useEffect } from 'react';

export function useClickOutside<T extends HTMLElement>(
  ref: RefObject<T>,
  handler: (event: MouseEvent | TouchEvent) => void
): void {
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (!ref?.current || ref.current.contains(event.target as Node)) {
        return;
      }
      handler(event);
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [ref, handler]);
}

export default useClickOutside;
