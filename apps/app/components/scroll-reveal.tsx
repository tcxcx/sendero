'use client';

import { useEffect } from 'react';

/**
 * Single IntersectionObserver that toggles `data-inview="true"` on any
 * element carrying `data-reveal` once it crosses the viewport threshold.
 * Pair with the reveal utilities defined in `@sendero/ui/motion.css`.
 *
 * Design notes (Emil):
 * - One observer, not one per element.
 * - Unobserve after first reveal — no re-trigger, no twitch.
 * - Threshold tight enough that content reveals just before it's centered,
 *   rootMargin negative so reveals don't fire before the user can see them.
 */
export function ScrollReveal() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      document
        .querySelectorAll<HTMLElement>('[data-reveal]')
        .forEach(el => (el.dataset.inview = 'true'));
      return;
    }

    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target as HTMLElement;
          el.dataset.inview = 'true';
          observer.unobserve(el);
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -6% 0px' }
    );

    const targets = document.querySelectorAll<HTMLElement>('[data-reveal]');
    targets.forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.top < window.innerHeight * 0.92) {
        el.dataset.inview = 'true';
        return;
      }
      observer.observe(el);
    });

    return () => observer.disconnect();
  }, []);

  return null;
}
