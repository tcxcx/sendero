'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Returns `[ref, isHovered]` for any element. Uses `pointerenter` /
 * `pointerleave` rather than `mouseenter` / `mouseleave` so it stays
 * accurate across touch → pen → mouse transitions and ignores
 * synthesized mouse events on touch devices.
 *
 * Attach the ref to the element you want to track:
 *
 *   const [ref, isHovered] = useHover<HTMLButtonElement>();
 *   return <button ref={ref}>…</button>;
 *
 * Safer than wiring `onMouseEnter` / `onMouseLeave` on components
 * that forward refs through Radix / Popover — the event timing
 * through portals is what makes manual timer-based hover-intent
 * logic flaky. Browser-native pointer events fire at the right
 * element boundary regardless of portal.
 */
export function useHover<T extends HTMLElement>(): [(node: T | null) => void, boolean] {
  const [isHovered, setHovered] = useState(false);
  const nodeRef = useRef<T | null>(null);

  const handleEnter = useCallback(() => setHovered(true), []);
  const handleLeave = useCallback(() => setHovered(false), []);

  const attach = useCallback(
    (node: T | null) => {
      const prev = nodeRef.current;
      if (prev) {
        prev.removeEventListener('pointerenter', handleEnter);
        prev.removeEventListener('pointerleave', handleLeave);
      }
      nodeRef.current = node;
      if (node) {
        node.addEventListener('pointerenter', handleEnter);
        node.addEventListener('pointerleave', handleLeave);
      } else {
        setHovered(false);
      }
    },
    [handleEnter, handleLeave]
  );

  useEffect(
    () => () => {
      const node = nodeRef.current;
      if (node) {
        node.removeEventListener('pointerenter', handleEnter);
        node.removeEventListener('pointerleave', handleLeave);
      }
    },
    [handleEnter, handleLeave]
  );

  return [attach, isHovered];
}
