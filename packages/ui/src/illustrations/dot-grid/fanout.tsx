'use client';

/**
 * Fanout — single anchor point fanning to six endpoint dots.
 * Commission splits, one-to-many, broadcast, distribution.
 */

import { useStrokeDraw } from '../../hooks/use-stroke-draw';
import { TONE_COLOR, VIEWBOX, X, Y, type DotGridIllustrationProps } from './types';

const ENDPOINTS: Array<[number, number]> = [
  [26, 4],
  [28, 7],
  [28, 11],
  [28, 15],
  [26, 18],
  [22, 19],
];

export function Fanout({
  tone = 'midnight',
  className,
  draw = 'intersection',
  delayMs = 0,
  ...props
}: DotGridIllustrationProps) {
  const svgRef = useStrokeDraw<SVGSVGElement>({ mode: draw, delayMs });
  const stroke = TONE_COLOR[tone];
  const anchor: [number, number] = [6, 11];

  return (
    <svg
      ref={svgRef}
      viewBox={VIEWBOX}
      width="100%"
      height="100%"
      role="img"
      aria-label={props['aria-label'] ?? 'Fanout'}
      className={className}
      fill="none"
      stroke={stroke}
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {ENDPOINTS.map(([nx, ny], i) => (
        <line
          key={i}
          x1={X(anchor[0])}
          y1={Y(anchor[1])}
          x2={X(nx)}
          y2={Y(ny)}
        />
      ))}
      <circle cx={X(anchor[0])} cy={Y(anchor[1])} r="3" fill={stroke} stroke="none" />
      {ENDPOINTS.map(([nx, ny], i) => (
        <circle key={`e-${i}`} cx={X(nx)} cy={Y(ny)} r="1.6" fill={stroke} stroke="none" />
      ))}
    </svg>
  );
}
