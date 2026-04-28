'use client';

/**
 * useClickOutside — fire `handler` when the user clicks/taps anywhere
 * outside the element referenced by `ref`. Standard implementation
 * pattern for closing dropdowns, popovers, tooltips, command palettes,
 * and morphing-dialog-style overlays without trapping focus.
 *
 * Listens on both `mousedown` (desktop) and `touchstart` (mobile).
 * Mousedown over click avoids the "drag-out-then-release" footgun
 * where a drag started inside the element ends outside and would
 * otherwise close it.
 *
 * Defensive: bails when `ref.current` is null (component not mounted)
 * or when the event target is contained by the ref (the click was
 * inside, not outside).
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
