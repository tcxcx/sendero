'use client';

/**
 * AgentChip — compact representation of the Pasillo travel agent's
 * ERC-8004 identity. Click to expand into a popover with the full card
 * (stars, feedback count, validators, arcscan link).
 */

import { useEffect, useRef, useState } from 'react';

interface AgentIdentity {
  agentId: string;
  providerAddress: string;
  stars: number;
  meanScore: number;
  count: number;
  validators: number;
  metadata: { name?: string; description?: string } | null;
  explorerUrl: string;
}

export function AgentChip() {
  const [data, setData] = useState<AgentIdentity | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    const fetchIdentity = async () => {
      try {
        const res = await fetch('/api/agent/identity', { cache: 'no-store' });
        if (!res.ok) return;
        const json = (await res.json()) as AgentIdentity;
        if (alive) setData(json);
      } catch {
        /* ignore */
      } finally {
        if (alive) setLoading(false);
      }
    };
    fetchIdentity();
    const iv = setInterval(fetchIdentity, 30_000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (loading && !data) {
    return (
      <div className="ac-chip ac-skeleton" aria-busy="true">
        <span className="ac-avatar" />
        <span className="ac-skel" style={{ width: 46 }} />
        <span className="ac-skel" style={{ width: 32 }} />
        <style jsx>{chipStyles}</style>
      </div>
    );
  }
  if (!data) return null;

  const name = data.metadata?.name ?? 'Pasillo Travel Agent';
  const shortAddr = `${data.providerAddress.slice(0, 6)}…${data.providerAddress.slice(-4)}`;

  return (
    <div className="ac-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`ac-chip ${open ? 'open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="ac-avatar">PS</span>
        <span className="ac-stars">★ {data.stars.toFixed(2)}</span>
        <span className="ac-id">#{data.agentId}</span>
      </button>

      {open && (
        <div className="ac-panel" role="menu">
          <div className="ac-header">
            <span className="ac-avatar lg">PS</span>
            <div className="ac-header-body">
              <div className="ac-name">{name}</div>
              <div className="ac-sub">ERC-8004 · token #{data.agentId}</div>
            </div>
          </div>

          <div className="ac-stats">
            <div className="ac-stat">
              <div className="ac-stat-v">★ {data.stars.toFixed(2)}</div>
              <div className="ac-stat-k">stars</div>
            </div>
            <div className="ac-stat">
              <div className="ac-stat-v">{data.count}</div>
              <div className="ac-stat-k">feedback</div>
            </div>
            <div className="ac-stat">
              <div className="ac-stat-v">{data.validators}</div>
              <div className="ac-stat-k">validators</div>
            </div>
            <div className="ac-stat">
              <div className="ac-stat-v">{data.meanScore.toFixed(0)}</div>
              <div className="ac-stat-k">mean score</div>
            </div>
          </div>

          <div className="ac-meta">
            <div className="ac-meta-row">
              <span className="ac-k">Provider</span>
              <span className="ac-v mono">{shortAddr}</span>
            </div>
          </div>

          <a
            className="ac-open"
            href={data.explorerUrl}
            target="_blank"
            rel="noreferrer"
          >
            View on Arcscan ↗
          </a>
        </div>
      )}

      <style jsx>{chipStyles}</style>
    </div>
  );
}

const chipStyles = `
  .ac-wrap {
    position: relative;
    display: inline-block;
  }
  .ac-chip {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px 4px 4px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.06em;
    transition: border-color 120ms;
  }
  .ac-chip:hover,
  .ac-chip.open {
    border-color: var(--ink);
  }
  .ac-skeleton {
    cursor: default;
    border-color: var(--border);
  }
  .ac-avatar {
    width: 22px;
    height: 22px;
    background: var(--ink);
    color: var(--bg-elev);
    font-family: var(--font-mono);
    font-size: 10px;
    display: grid;
    place-items: center;
  }
  .ac-avatar.lg {
    width: 32px;
    height: 32px;
    font-size: 12px;
  }
  .ac-stars {
    color: var(--ink);
  }
  .ac-id {
    color: var(--text-dim);
    padding: 0 4px;
    border-left: 1px solid var(--border);
  }
  .ac-skel {
    height: 8px;
    background: var(--border);
    border-radius: 2px;
    animation: ac-pulse 1.4s ease-in-out infinite;
  }
  @keyframes ac-pulse {
    0%, 100% { opacity: 0.5; }
    50%      { opacity: 0.85; }
  }

  .ac-panel {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    z-index: 60;
    width: 296px;
    background: var(--bg-elev);
    border: 1.5px solid var(--ink);
    box-shadow: 0 10px 28px -14px rgba(0, 0, 0, 0.22),
      0 2px 8px -3px rgba(0, 0, 0, 0.08);
    display: flex;
    flex-direction: column;
    animation: ac-in 160ms ease-out;
  }
  @keyframes ac-in {
    from { transform: translateY(-6px); opacity: 0; }
    to   { transform: translateY(0);    opacity: 1; }
  }
  .ac-header {
    display: flex;
    gap: 12px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--border);
    align-items: center;
  }
  .ac-header-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .ac-name {
    font-family: var(--font-sans);
    font-size: 14px;
    font-weight: 500;
    letter-spacing: -0.01em;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ac-sub {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.06em;
    color: var(--text-dim);
    text-transform: uppercase;
  }

  .ac-stats {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0;
    border-bottom: 1px solid var(--border);
  }
  .ac-stat {
    padding: 10px 6px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    align-items: center;
    border-right: 1px solid var(--border);
  }
  .ac-stat:last-child { border-right: 0; }
  .ac-stat-v {
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--ink);
    letter-spacing: 0.02em;
  }
  .ac-stat-k {
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-faint);
  }

  .ac-meta {
    padding: 10px 14px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .ac-meta-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-family: var(--font-mono);
  }
  .ac-k {
    font-size: 9px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .ac-v {
    font-size: 11px;
    color: var(--text);
  }
  .ac-v.mono {
    color: var(--ink);
  }

  .ac-open {
    padding: 10px 14px;
    border-top: 1px solid var(--border);
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--ink);
    text-decoration: none;
    text-align: center;
    transition: background 120ms;
  }
  .ac-open:hover {
    background: color-mix(in oklab, var(--ink) 6%, transparent);
  }
`;
