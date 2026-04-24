'use client';

/**
 * BarCluster — 7 vertical bars, one elevated with a downward chevron
 * marking it. Distribution / breakdown views.
 */

import { useStrokeDraw } from '../../hooks/use-stroke-draw';
import { TONE_COLOR, VIEWBOX, X, Y, type DotGridIllustrationProps } from './types';

const HEIGHTS = [5, 7, 4, 9, 6, 8, 5];
const PEAK_INDEX = 3;

export function BarCluster({
  tone = 'midnight',
  className,
  draw = 'intersection',
  delayMs = 0,
  ...props
}: DotGridIllustrationProps) {
  const svgRef = useStrokeDraw<SVGSVGElement>({ mode: draw, delayMs });
  const stroke = TONE_COLOR[tone];
  const baselineY = Y(16);
  const startX = X(6);
  const step = X(3);

  return (
    <svg
      ref={svgRef}
      viewBox={VIEWBOX}
      width="100%"
      height="100%"
      role="img"
      aria-label={props['aria-label'] ?? 'Bar cluster'}
      className={className}
      fill="none"
      stroke={stroke}
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {HEIGHTS.map((h, i) => {
        const x = startX + step * i;
        const y = baselineY - Y(h);
        return <line key={i} x1={x} y1={baselineY} x2={x} y2={y} />;
      })}
      {/* Downward chevron above the peak */}
      <path
        d={`M ${startX + step * PEAK_INDEX - 4} ${baselineY - Y(HEIGHTS[PEAK_INDEX]) - 8} L ${startX + step * PEAK_INDEX} ${baselineY - Y(HEIGHTS[PEAK_INDEX]) - 4} L ${startX + step * PEAK_INDEX + 4} ${baselineY - Y(HEIGHTS[PEAK_INDEX]) - 8}`}
      />
      {/* Baseline */}
      <line x1={X(4)} y1={baselineY} x2={X(30)} y2={baselineY} opacity="0.3" />
    </svg>
  );
}
