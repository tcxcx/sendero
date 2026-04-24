'use client';

/**
 * PeakedLine — jagged line graph with dots at each vertex. Monitoring,
 * latency, uptime.
 */

import { useStrokeDraw } from '../../hooks/use-stroke-draw';
import { TONE_COLOR, VIEWBOX, X, Y, type DotGridIllustrationProps } from './types';

const POINTS: Array<[number, number]> = [
  [4, 14],
  [8, 11],
  [12, 13],
  [16, 7],
  [20, 9],
  [24, 6],
  [28, 10],
  [30, 8],
];

export function PeakedLine({
  tone = 'midnight',
  className,
  draw = 'intersection',
  delayMs = 0,
  ...props
}: DotGridIllustrationProps) {
  const svgRef = useStrokeDraw<SVGSVGElement>({ mode: draw, delayMs });
  const stroke = TONE_COLOR[tone];
  const d = POINTS.map(([nx, ny], i) => `${i === 0 ? 'M' : 'L'} ${X(nx)} ${Y(ny)}`).join(' ');

  return (
    <svg
      ref={svgRef}
      viewBox={VIEWBOX}
      width="100%"
      height="100%"
      role="img"
      aria-label={props['aria-label'] ?? 'Peaked line'}
      className={className}
      fill="none"
      stroke={stroke}
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
      {POINTS.map(([nx, ny], i) => (
        <circle key={i} cx={X(nx)} cy={Y(ny)} r="1.6" fill={stroke} stroke="none" />
      ))}
    </svg>
  );
}
