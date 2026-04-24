import { useEffect, useRef } from 'react';

export function useClickAway<T extends HTMLElement>(
  handler: (ev: MouseEvent | TouchEvent) => void
) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const onDown = (ev: MouseEvent | TouchEvent) => {
      const el = ref.current;
      if (!el || el.contains(ev.target as Node)) return;
      handler(ev);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown, { passive: true });
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, [handler]);
  return ref;
}
