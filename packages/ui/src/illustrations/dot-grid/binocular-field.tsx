'use client';

/**
 * BinocularField — two concentric circles with a horizon line.
 * Discovery, intake, search. Sendero-native — mirrors the platform
 * icon's lens language.
 */

import { useStrokeDraw } from '../../hooks/use-stroke-draw';
import { TONE_COLOR, VIEWBOX, X, Y, type DotGridIllustrationProps } from './types';

export function BinocularField({
  tone = 'midnight',
  className,
  draw = 'intersection',
  delayMs = 0,
  ...props
}: DotGridIllustrationProps) {
  const svgRef = useStrokeDraw<SVGSVGElement>({ mode: draw, delayMs });
  const stroke = TONE_COLOR[tone];
  const cx = X(15);
  const cy = Y(10);

  return (
    <svg
      ref={svgRef}
      viewBox={VIEWBOX}
      width="100%"
      height="100%"
      role="img"
      aria-label={props['aria-label'] ?? 'Binocular field'}
      className={className}
      fill="none"
      stroke={stroke}
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Outer lens */}
      <circle cx={cx} cy={cy} r={X(6)} />
      {/* Inner lens */}
      <circle cx={cx} cy={cy} r={X(3.25)} opacity="0.7" />
      {/* Horizon line across the lens */}
      <line x1={cx - X(5.5)} y1={cy} x2={cx + X(5.5)} y2={cy} opacity="0.4" />
      {/* Star mark inside the lens, upper-left quadrant */}
      <path
        d={`M ${cx - X(1.5)} ${cy - X(1)} l 1.5 -3 l 1.5 3 l 3 0 l -2.4 2 l 1 3 l -3 -1.8 l -3 1.8 l 1 -3 l -2.4 -2 z`}
        opacity="0.9"
      />
    </svg>
  );
}
