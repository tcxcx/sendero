/**
 * Shared types + constants for the dotted-grid micro-illustrations
 * (DESIGN.md §19).
 */

export type IllustrationTone = 'midnight' | 'vermillion' | 'sea' | 'sand';

export interface DotGridIllustrationProps {
  /** Stroke color family. Default "midnight". */
  tone?: IllustrationTone;
  /** Optional className forwarded to the <svg>. */
  className?: string;
  /** Override aria-label. Default: each illustration's canonical name. */
  'aria-label'?: string;
  /**
   * When the draw should trigger. Default "intersection" (draws as the
   * illustration scrolls into view); use "mount" for above-the-fold
   * renders.
   */
  draw?: 'mount' | 'intersection';
  /** Stagger delay in ms — useful for grids. */
  delayMs?: number;
}

export const TONE_COLOR: Record<IllustrationTone, string> = {
  midnight: 'color-mix(in oklab, var(--sendero-midnight, #1f2a44) 70%, transparent)',
  vermillion: 'var(--sendero-vermillion, #d65438)',
  sea: 'var(--sendero-sea, #0f7c82)',
  sand: 'var(--sendero-sand, #b6844e)',
};

/** Canonical viewBox for all seven illustrations (3:2 aspect). */
export const VIEWBOX = '0 0 240 160';

/** 8px dot-grid intersection helpers (viewBox-space). */
export const GRID = 8;
export const X = (nx: number) => nx * GRID;
export const Y = (ny: number) => ny * GRID;
