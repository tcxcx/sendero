'use client';

/**
 * Pasillo × Arc — Globe Hero (SVG dotted sphere)
 *
 * Pure SVG/CSS, no CDN. Cobe-styled Fibonacci-sphere point distribution,
 * draggable rotation, great-circle arcs between airport markers.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';

interface Marker {
  lat: number;
  lon: number;
  code: string;
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

// Fibonacci-sphere point distribution projected orthographically.
function generateDots(count: number): Vec3[] {
  const pts: Vec3[] = [];
  const phi = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = phi * i;
    pts.push({ x: Math.cos(theta) * r, y, z: Math.sin(theta) * r });
  }
  return pts;
}

const MARKERS: Marker[] = [
  { lat: 37.78, lon: -122.41, code: 'SFO' },
  { lat: 40.71, lon: -74.01, code: 'JFK' },
  { lat: 51.51, lon: -0.13, code: 'LHR' },
  { lat: 52.52, lon: 13.4, code: 'BER' },
  { lat: 48.85, lon: 2.35, code: 'CDG' },
  { lat: 38.72, lon: -9.14, code: 'LIS' },
  { lat: 41.9, lon: 12.49, code: 'FCO' },
  { lat: 25.2, lon: 55.27, code: 'DXB' },
  { lat: 1.35, lon: 103.81, code: 'SIN' },
  { lat: -34.61, lon: -58.37, code: 'EZE' },
  { lat: 42.36, lon: -71.05, code: 'BOS' },
];

function latLonTo3D(lat: number, lon: number): Vec3 {
  const la = (lat * Math.PI) / 180;
  const lo = (lon * Math.PI) / 180;
  return {
    x: Math.cos(la) * Math.cos(lo),
    y: Math.sin(la),
    z: Math.cos(la) * Math.sin(lo),
  };
}

function rotateY({ x, y, z }: Vec3, a: number): Vec3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: c * x + s * z, y, z: -s * x + c * z };
}

export function GlobeHero({
  onEnter,
  onHide,
}: {
  onEnter: () => void;
  onHide: () => void;
}) {
  const [phi, setPhi] = useState(0);
  const pointerRef = useRef({ down: false, startX: 0 });
  const dragRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  const dots = useMemo(() => generateDots(520), []);

  useEffect(() => {
    let last = performance.now();
    const loop = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setPhi((p) => p + dt * 0.22);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const onDown: React.PointerEventHandler<SVGSVGElement> = (e) => {
    pointerRef.current.down = true;
    pointerRef.current.startX = e.clientX - dragRef.current;
  };
  const onMove: React.PointerEventHandler<SVGSVGElement> = (e) => {
    if (!pointerRef.current.down) return;
    dragRef.current = e.clientX - pointerRef.current.startX;
    setPhi((p) => p); // trigger re-render
  };
  const onUp: React.PointerEventHandler<SVGSVGElement> = () => {
    pointerRef.current.down = false;
  };

  const rotation = phi + dragRef.current * 0.008;
  const R = 240;
  const CX = 300;
  const CY = 300;

  const projected = dots.map((d) => {
    const r = rotateY(d, rotation);
    const visible = r.z > -0.05;
    return {
      cx: CX + r.x * R,
      cy: CY - r.y * R,
      z: r.z,
      visible,
      size: 1 + r.z * 0.6,
      opacity: visible ? Math.max(0.15, (r.z + 0.2) * 0.85) : 0,
    };
  });

  const markerPts = MARKERS.map((m) => {
    const v = latLonTo3D(m.lat, m.lon);
    const r = rotateY(v, rotation);
    const visible = r.z > 0.05;
    return {
      code: m.code,
      cx: CX + r.x * R,
      cy: CY - r.y * R,
      z: r.z,
      visible,
      opacity: visible ? Math.min(1, r.z + 0.2) : 0,
    };
  });

  const arcPairs = [
    ['SFO', 'LHR'],
    ['JFK', 'CDG'],
    ['DXB', 'SIN'],
    ['JFK', 'FCO'],
  ];
  const arcs = arcPairs
    .map(([a, b], i) => {
      const pa = markerPts.find((m) => m.code === a);
      const pb = markerPts.find((m) => m.code === b);
      if (!pa || !pb || (!pa.visible && !pb.visible)) return null;
      const mx = (pa.cx + pb.cx) / 2;
      const my = (pa.cy + pb.cy) / 2;
      const dx = pb.cx - pa.cx;
      const dy = pb.cy - pa.cy;
      const dist = Math.hypot(dx, dy);
      const lift = Math.min(120, dist * 0.45);
      return {
        d: `M ${pa.cx} ${pa.cy} Q ${mx} ${my - lift} ${pb.cx} ${pb.cy}`,
        key: i,
        op: Math.min(pa.opacity, pb.opacity) * 0.9,
      };
    })
    .filter(Boolean) as { d: string; key: number; op: number }[];

  return (
    <div className="globe-overlay" id="globeHero">
      <div className="topbar">
        <div className="topbar-left">
          <div className="logo">
            <div className="logo-mark" />
            <span>PASILLO</span>
          </div>
          <div className="breadcrumb">
            <span>HACKATHON ENTRY</span>
            <span className="sep">/</span>
            <span className="cur">Arc × Circle · Spring 2026</span>
          </div>
        </div>
        <div className="topbar-right">
          <span className="tag ink">B2B2C</span>
          <span className="tag faint">ALPHA</span>
          <button
            className="btn"
            onClick={onHide}
            style={{ padding: '4px 10px', fontSize: 10 }}
          >
            Hide hero
          </button>
        </div>
      </div>

      <div className="globe-stage">
        <div className="globe-left">
          <div className="globe-eyebrow">
            <span>◆ Pasillo</span>
            <span className="sep">×</span>
            <span>Arc · Circle · CCTP v2</span>
          </div>
          <h1 className="globe-title">
            An AI travel
            <br />
            agent that <em>books</em>
            <br />
            and <em>settles</em> itself.
          </h1>
          <p className="globe-sub">
            Pasillo is a B2B2C travel platform — partners plug in their corporate
            traveler base, and every flight, hotel and ground leg is booked by an AI
            workflow and settled on Arc in USDC or EURC.
          </p>
          <div className="globe-actions">
            <button className="btn primary" onClick={onEnter}>
              Enter console →
            </button>
            <a
              className="btn"
              href="#scenarios"
              onClick={(e) => {
                e.preventDefault();
                onEnter();
              }}
            >
              See 6 scenarios
            </a>
          </div>

          <div className="globe-spec">
            <div className="globe-spec-cell">
              <span className="k">Settlement</span>
              <span className="v">&lt; 6s</span>
            </div>
            <div className="globe-spec-cell">
              <span className="k">Tokens</span>
              <span className="v">USDC · EURC</span>
            </div>
            <div className="globe-spec-cell">
              <span className="k">Network</span>
              <span className="v">Arc L2</span>
            </div>
          </div>
        </div>

        <div className="globe-right">
          <div className="globe-orbit">
            <svg viewBox="0 0 600 600" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <path
                  id="orbitPath"
                  d="M 300 300 m -290, 0 a 290,290 0 1,1 580,0 a 290,290 0 1,1 -580,0"
                />
              </defs>
              <text className="globe-orbit-text">
                <textPath href="#orbitPath" startOffset="0">
                  PSL-ACME-TR-0481 · SETTLED 5,723.70 USDC · BLOCK 8,482,114 · CIRCLE
                  CCTP v2 · ARC L2 · PSL-NW-VIVA-0091 · SETTLED 1,697.50 USDC ·
                  BLOCK 8,482,120 ·&nbsp;
                </textPath>
              </text>
            </svg>
          </div>

          <svg
            className="globe-svg"
            viewBox="0 0 600 600"
            xmlns="http://www.w3.org/2000/svg"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerLeave={onUp}
          >
            <defs>
              <radialGradient id="globeGlow" cx="50%" cy="50%" r="52%">
                <stop offset="0%" stopColor="var(--bg-elev)" stopOpacity="1" />
                <stop offset="82%" stopColor="var(--bg-elev)" stopOpacity="1" />
                <stop offset="100%" stopColor="var(--ink)" stopOpacity="0.18" />
              </radialGradient>
              <radialGradient id="globeShade" cx="38%" cy="36%" r="62%">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.0" />
                <stop offset="70%" stopColor="var(--ink)" stopOpacity="0.05" />
                <stop offset="100%" stopColor="var(--ink)" stopOpacity="0.22" />
              </radialGradient>
            </defs>

            <circle cx="300" cy="300" r="260" fill="url(#globeGlow)" />
            <circle
              cx="300"
              cy="300"
              r="240"
              fill="var(--bg-elev)"
              stroke="var(--ink)"
              strokeOpacity="0.25"
              strokeWidth="1"
            />

            <g>
              {projected.map(
                (p, i) =>
                  p.visible && (
                    <circle
                      key={i}
                      cx={p.cx}
                      cy={p.cy}
                      r={p.size}
                      fill="var(--ink)"
                      opacity={p.opacity * 0.75}
                    />
                  ),
              )}
            </g>

            <circle
              cx="300"
              cy="300"
              r="240"
              fill="url(#globeShade)"
              pointerEvents="none"
            />

            <g fill="none" stroke="var(--ink)" strokeWidth="1.5">
              {arcs.map((a) => (
                <path key={a.key} d={a.d} opacity={a.op} />
              ))}
            </g>

            <g>
              {markerPts.map(
                (m, i) =>
                  m.visible && (
                    <g key={i} opacity={m.opacity}>
                      <circle cx={m.cx} cy={m.cy} r="4" fill="var(--ink)" />
                      <circle
                        cx={m.cx}
                        cy={m.cy}
                        r="8"
                        fill="none"
                        stroke="var(--ink)"
                        strokeOpacity="0.35"
                        strokeWidth="1"
                      />
                      <text
                        x={m.cx + 10}
                        y={m.cy + 3}
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 9,
                          fill: 'var(--ink)',
                          letterSpacing: '0.1em',
                        }}
                      >
                        {m.code}
                      </text>
                    </g>
                  ),
              )}
            </g>
          </svg>
        </div>
      </div>

      <div className="globe-marquee">
        <div className="globe-marquee-track">
          <span className="ink">● ARC × CIRCLE HACKATHON</span>
          <span>USDC</span>
          <span>EURC</span>
          <span>CCTP v2</span>
          <span className="ink">● B2B2C TRAVEL</span>
          <span>SFO→LHR→BER</span>
          <span>JFK→CDG</span>
          <span>DXB→SIN</span>
          <span>JFK→FCO</span>
          <span className="ink">● AI-ASSISTED BOOKING</span>
          <span>MULTI-LEG</span>
          <span>POLICY-AWARE</span>
          <span>APPROVAL CHAIN</span>
          <span>INSTANT SETTLE</span>
          <span className="ink">● ARC × CIRCLE HACKATHON</span>
          <span>USDC</span>
          <span>EURC</span>
          <span>CCTP v2</span>
          <span className="ink">● B2B2C TRAVEL</span>
          <span>SFO→LHR→BER</span>
          <span>JFK→CDG</span>
          <span>DXB→SIN</span>
          <span>JFK→FCO</span>
          <span className="ink">● AI-ASSISTED BOOKING</span>
          <span>MULTI-LEG</span>
          <span>POLICY-AWARE</span>
          <span>APPROVAL CHAIN</span>
          <span>INSTANT SETTLE</span>
        </div>
      </div>
    </div>
  );
}
