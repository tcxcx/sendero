'use client';

/**
 * useStrokeDraw — drive an SVG stroke-draw reveal (left-to-right or
 * start-to-end along the path) via `stroke-dasharray` and
 * `stroke-dashoffset`. The element must be an SVG `path` / `polyline`
 * / `line` / `circle` / `rect` that supports `getTotalLength()`.
 *
 * Timing follows DESIGN.md §5: 600ms ease-out on first enter.
 *
 * Accepts three modes:
 *   - "mount"           — start drawing on mount.
 *   - "intersection"    — start drawing when the element enters
 *                         the viewport (IntersectionObserver).
 *   - "hover"           — controlled via a parent hover container
 *                         (requires callers to toggle via CSS).
 *
 * Reduced-motion: resolves to the final drawn state on first render,
 * no tween.
 */

import { useEffect, useRef } from 'react';

export type StrokeDrawMode = 'mount' | 'intersection';

export interface UseStrokeDrawOptions {
  /** Milliseconds for the draw to complete. Default 600ms. */
  durationMs?: number;
  /**
   * Delay before starting, in ms. Useful for staggering a grid of
   * illustrations (FeatureGrid uses 80ms between cells).
   */
  delayMs?: number;
  /** When to trigger. Default "intersection". */
  mode?: StrokeDrawMode;
  /** IntersectionObserver threshold. Default 0.25. */
  threshold?: number;
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

type DrawableElement = SVGPathElement | SVGPolylineElement | SVGLineElement;

function hasGetTotalLength(el: SVGElement): el is DrawableElement {
  return typeof (el as DrawableElement).getTotalLength === 'function';
}

export function useStrokeDraw<T extends SVGSVGElement>(
  options: UseStrokeDrawOptions = {}
) {
  const { durationMs = 600, delayMs = 0, mode = 'intersection', threshold = 0.25 } = options;
  const svgRef = useRef<T | null>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const drawables = Array.from(
      svg.querySelectorAll<SVGElement>('path, polyline, line')
    ).filter(hasGetTotalLength);

    if (drawables.length === 0) return;

    const reduced = prefersReducedMotion();

    const prime = () => {
      for (const el of drawables) {
        const length = el.getTotalLength();
        el.style.strokeDasharray = `${length}`;
        el.style.strokeDashoffset = reduced ? '0' : `${length}`;
        el.style.transition = reduced
          ? 'none'
          : `stroke-dashoffset ${durationMs}ms cubic-bezier(0.23, 1, 0.32, 1)`;
      }
    };

    const reveal = () => {
      for (const el of drawables) {
        el.style.strokeDashoffset = '0';
      }
    };

    prime();
    if (reduced) return;

    let frame = 0;
    const trigger = () => {
      frame = window.setTimeout(reveal, delayMs);
    };

    if (mode === 'mount') {
      trigger();
      return () => window.clearTimeout(frame);
    }

    let observer: IntersectionObserver | null = null;
    observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            trigger();
            observer?.disconnect();
            observer = null;
            return;
          }
        }
      },
      { threshold }
    );
    observer.observe(svg);
    return () => {
      window.clearTimeout(frame);
      observer?.disconnect();
    };
  }, [durationMs, delayMs, mode, threshold]);

  return svgRef;
}
