'use client';

import { useEffect, useRef, useState } from 'react';

interface WorkspaceReputation {
  displayName: string;
  status: string;
  agentId: string | null;
  stars: number | null;
  feedbackCount: number;
  validatorCount: number;
  validationCount: number;
  publicUrl: string;
}

export function WorkspaceReputationChip() {
  const [data, setData] = useState<WorkspaceReputation | null>(null);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch('/api/reputation/workspace', { cache: 'no-store' });
        if (!res.ok) return;
        const json = (await res.json()) as WorkspaceReputation;
        if (alive) setData(json);
      } catch {
        /* header chip stays hidden until the reputation route responds */
      }
    };
    void load();
    const id = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!data) return null;

  const stars = data.stars === null ? '—' : data.stars.toFixed(2);
  const initials =
    data.displayName
      .split(/\s+/)
      .map(part => part[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase() || 'WS';

  return (
    <div className="wr-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`sd-corner-hover wr-chip ${open ? 'open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
      >
        <span className="wr-avatar">{initials}</span>
        <span className="wr-stars">★ {stars}</span>
        <span className="wr-id">{data.agentId ? `#${data.agentId}` : data.status}</span>
        <span className={`wr-chev ${open ? 'open' : ''}`} aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <div className="wr-panel" role="menu">
          <div className="wr-head">
            <span className="wr-avatar lg">{initials}</span>
            <div className="wr-title">
              <div className="wr-name">{data.displayName}</div>
              <div className="wr-sub">Workspace customer profile</div>
            </div>
          </div>
          <div className="wr-stats">
            <Stat value={stars} label="stars" />
            <Stat value={String(data.feedbackCount)} label="ratings" />
            <Stat value={String(data.validatorCount)} label="raters" />
            <Stat value={String(data.validationCount)} label="checks" />
          </div>
          <a className="wr-link" href={data.publicUrl} target="_blank" rel="noreferrer">
            View public reputation →
          </a>
        </div>
      )}

      <style jsx global>{`
        .wr-wrap { position: relative; display: inline-block; }
        .wr-chip {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          height: 28px;
          padding: 0 8px 0 4px;
          border: 1px solid var(--border);
          background: var(--bg-elev);
          color: var(--text);
          cursor: pointer;
          font-family: var(--font-mono);
          font-size: 10px;
          letter-spacing: 0.06em;
          transition: border-color 120ms;
        }
        .wr-chip:hover, .wr-chip.open { border-color: var(--ink); }
        .wr-avatar {
          width: 20px;
          height: 20px;
          display: grid;
          place-items: center;
          background: color-mix(in oklab, var(--ink) 78%, var(--midnight));
          color: var(--bg-elev);
          font-size: 9px;
        }
        .wr-avatar.lg { width: 32px; height: 32px; font-size: 12px; }
        .wr-stars { color: var(--ink); }
        .wr-id { color: var(--text-dim); padding-left: 6px; border-left: 1px solid var(--border); }
        .wr-chev { color: var(--ink); transition: transform 160ms ease; }
        .wr-chev.open { transform: rotate(-180deg); }
        .wr-panel {
          position: absolute;
          top: calc(100% + 8px);
          right: 0;
          z-index: 60;
          width: 296px;
          border: 1.5px solid var(--ink);
          background: var(--bg-elev);
          box-shadow: 0 10px 28px -14px rgba(0, 0, 0, 0.22);
        }
        .wr-head { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-bottom: 1px solid var(--border); }
        .wr-title { min-width: 0; }
        .wr-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 500; color: var(--text); }
        .wr-sub { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-dim); }
        .wr-stats { display: grid; grid-template-columns: repeat(4, 1fr); border-bottom: 1px solid var(--border); }
        .wr-stat { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 10px 4px; border-right: 1px solid var(--border); }
        .wr-stat:last-child { border-right: 0; }
        .wr-stat-v { font-family: var(--font-mono); font-size: 13px; color: var(--ink); }
        .wr-stat-k { font-family: var(--font-mono); font-size: 9px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-faint); }
        .wr-link { display: block; padding: 10px 14px; text-align: center; font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--ink); text-decoration: none; }
        .wr-link:hover { background: color-mix(in oklab, var(--ink) 6%, transparent); }
        @media (max-width: 720px) {
          .wr-chip { max-width: 132px; }
          .wr-id { display: none; }
        }
      `}</style>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="wr-stat">
      <div className="wr-stat-v">{value}</div>
      <div className="wr-stat-k">{label}</div>
    </div>
  );
}
