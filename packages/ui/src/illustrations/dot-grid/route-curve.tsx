'use client';

/**
 * RouteCurve — an S-curve with endpoint dots. Trip / itinerary stages.
 */

import { useStrokeDraw } from '../../hooks/use-stroke-draw';
import { TONE_COLOR, VIEWBOX, X, Y, type DotGridIllustrationProps } from './types';

export function RouteCurve({
  tone = 'midnight',
  className,
  draw = 'intersection',
  delayMs = 0,
  ...props
}: DotGridIllustrationProps) {
  const svgRef = useStrokeDraw<SVGSVGElement>({ mode: draw, delayMs });
  const stroke = TONE_COLOR[tone];

  return (
    <svg
      ref={svgRef}
      viewBox={VIEWBOX}
      width="100%"
      height="100%"
      role="img"
      aria-label={props['aria-label'] ?? 'Route curve'}
      className={className}
      fill="none"
      stroke={stroke}
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* S-curve, anchored to grid intersections */}
      <path
        d={`M ${X(4)} ${Y(15)} C ${X(10)} ${Y(15)}, ${X(12)} ${Y(5)}, ${X(18)} ${Y(5)} S ${X(26)} ${Y(15)}, ${X(30)} ${Y(15)}`}
      />
      {/* Endpoint dots */}
      <circle cx={X(4)} cy={Y(15)} r="2.5" fill={stroke} stroke="none" />
      <circle cx={X(30)} cy={Y(15)} r="2.5" fill={stroke} stroke="none" />
    </svg>
  );
}
