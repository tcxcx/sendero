'use client';

/**
 * BouncingPath — two arcs that meet the baseline. Claims, retries,
 * handoff bounces.
 */

import { useStrokeDraw } from '../../hooks/use-stroke-draw';
import { TONE_COLOR, VIEWBOX, X, Y, type DotGridIllustrationProps } from './types';

export function BouncingPath({
  tone = 'midnight',
  className,
  draw = 'intersection',
  delayMs = 0,
  ...props
}: DotGridIllustrationProps) {
  const svgRef = useStrokeDraw<SVGSVGElement>({ mode: draw, delayMs });
  const stroke = TONE_COLOR[tone];
  const baseline = Y(15);

  return (
    <svg
      ref={svgRef}
      viewBox={VIEWBOX}
      width="100%"
      height="100%"
      role="img"
      aria-label={props['aria-label'] ?? 'Bouncing path'}
      className={className}
      fill="none"
      stroke={stroke}
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Baseline */}
      <line x1={X(4)} y1={baseline} x2={X(30)} y2={baseline} opacity="0.3" />
      {/* First arc, rises then touches baseline */}
      <path
        d={`M ${X(4)} ${baseline} Q ${X(10)} ${Y(5)}, ${X(15)} ${baseline}`}
      />
      {/* Second arc, shorter, then stops */}
      <path
        d={`M ${X(15)} ${baseline} Q ${X(20)} ${Y(9)}, ${X(24)} ${baseline}`}
      />
      {/* Anchor dots at bounce points */}
      <circle cx={X(4)} cy={baseline} r="2" fill={stroke} stroke="none" />
      <circle cx={X(15)} cy={baseline} r="1.6" fill={stroke} stroke="none" />
      <circle cx={X(24)} cy={baseline} r="2" fill={stroke} stroke="none" />
    </svg>
  );
}
