'use client';

/**
 * ConnectedNodes — three rectangles connected by paths. Integrations,
 * custom flows, pipelines.
 */

import { useStrokeDraw } from '../../hooks/use-stroke-draw';
import { TONE_COLOR, VIEWBOX, X, Y, type DotGridIllustrationProps } from './types';

export function ConnectedNodes({
  tone = 'midnight',
  className,
  draw = 'intersection',
  delayMs = 0,
  ...props
}: DotGridIllustrationProps) {
  const svgRef = useStrokeDraw<SVGSVGElement>({ mode: draw, delayMs });
  const stroke = TONE_COLOR[tone];
  // Three nodes: left (8,6), center (16,14), right (24,6). w/h per node.
  const nodes: Array<[number, number]> = [
    [6, 5],
    [14, 12],
    [22, 5],
  ];
  const w = X(4);
  const h = Y(4);

  return (
    <svg
      ref={svgRef}
      viewBox={VIEWBOX}
      width="100%"
      height="100%"
      role="img"
      aria-label={props['aria-label'] ?? 'Connected nodes'}
      className={className}
      fill="none"
      stroke={stroke}
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Connectors — drawn first so nodes sit on top */}
      <path
        d={`M ${X(nodes[0][0]) + w / 2} ${Y(nodes[0][1]) + h} Q ${X(nodes[0][0]) + w / 2} ${Y(nodes[1][1])}, ${X(nodes[1][0])} ${Y(nodes[1][1]) + h / 2}`}
      />
      <path
        d={`M ${X(nodes[1][0]) + w} ${Y(nodes[1][1]) + h / 2} Q ${X(nodes[2][0]) + w / 2} ${Y(nodes[1][1])}, ${X(nodes[2][0]) + w / 2} ${Y(nodes[2][1]) + h}`}
      />
      {/* Nodes */}
      {nodes.map(([nx, ny], i) => (
        <rect key={i} x={X(nx)} y={Y(ny)} width={w} height={h} rx="2" />
      ))}
    </svg>
  );
}
