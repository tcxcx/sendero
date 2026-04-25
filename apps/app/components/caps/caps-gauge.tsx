/**
 * CapsGauge — design-canvas gauge from `route-artboards.jsx::CapsA`.
 *
 *   t-meta label  ·  $used / $max
 *   {pct}%        (huge num)
 *   ▰▰▰▱▱▱▱▱▱▱   progress bar (vermillion if pct ≥ warnAtPct, sea otherwise)
 *
 * `pct` is computed by the caller (server) so the gauge stays a pure
 * presentational atom.
 */

import { formatMicroUsd } from '@/lib/format';

interface CapsGaugeProps {
  label: string;
  usedMicro: bigint;
  ceilingMicro: bigint | null;
  warnAtPct?: number;
}

export function CapsGauge({ label, usedMicro, ceilingMicro, warnAtPct = 80 }: CapsGaugeProps) {
  const usable = ceilingMicro && ceilingMicro > 0n;
  const rawPct = usable ? (Number(usedMicro) / Number(ceilingMicro)) * 100 : 0;
  const pct = usable ? Math.min(100, rawPct) : 0;
  const tone = !usable ? 'outline' : rawPct >= warnAtPct ? 'verm' : 'sea';
  const barColor =
    tone === 'verm' ? 'var(--vermillion)' : tone === 'sea' ? 'var(--sea)' : 'var(--hairline-color)';

  return (
    <div style={{ flex: 1, padding: '4px 0', minWidth: 0 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 8,
        }}
      >
        <span className="t-meta">{label}</span>
        <span className="t-mono ink-70" style={{ fontSize: 11 }}>
          {usable
            ? `${formatMicroUsd(usedMicro)} / ${formatMicroUsd(ceilingMicro!)}`
            : `${formatMicroUsd(usedMicro)} / —`}
        </span>
      </div>
      <div
        className="t-num-md"
        style={{ marginTop: 6, fontSize: 32, fontVariantNumeric: 'tabular-nums' }}
      >
        {usable ? `${rawPct.toFixed(0)}%` : '—'}
      </div>
      <div
        style={{
          height: 8,
          background: 'var(--tint-midnight-soft)',
          borderRadius: 4,
          marginTop: 10,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: barColor,
            transition: 'width 200ms ease',
          }}
        />
      </div>
    </div>
  );
}
