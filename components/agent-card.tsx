'use client';

/**
 * AgentCard — the identity + reputation chip visible throughout the demo.
 *
 * Polls /api/agent/identity every 30s. Shows the Pasillo agent's ERC-8004
 * NFT ID, reputation score (★), and wallet address with a link to Arcscan.
 */

import { useEffect, useState } from 'react';

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

export function AgentCard() {
  const [data, setData] = useState<AgentIdentity | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const fetchIdentity = async () => {
      try {
        const res = await fetch('/api/agent/identity', { cache: 'no-store' });
        const json = await res.json();
        if (!alive) return;
        if (!res.ok) {
          setFetchError(json?.message || json?.error || `HTTP ${res.status}`);
          return;
        }
        setFetchError(null);
        setData(json as AgentIdentity);
      } catch (err) {
        if (alive) {
          setFetchError(err instanceof Error ? err.message : String(err));
        }
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

  if (loading && !data) {
    return (
      <div className="agent-card agent-card-loading" aria-busy="true">
        <span className="agent-card-avatar agent-card-avatar-skel">PS</span>
        <div className="agent-card-body">
          <div className="agent-card-row">
            <span className="agent-card-skel-bar" style={{ width: 140 }} />
            <span className="agent-card-skel-chip" />
          </div>
          <div className="agent-card-row">
            <span className="agent-card-skel-bar" style={{ width: 40 }} />
            <span className="agent-card-sep">·</span>
            <span className="agent-card-skel-bar" style={{ width: 70 }} />
            <span className="agent-card-sep">·</span>
            <span className="agent-card-skel-bar" style={{ width: 80 }} />
            <span className="agent-card-sep">·</span>
            <span className="agent-card-skel-bar mono" style={{ width: 92 }} />
          </div>
        </div>
        <span className="agent-card-arrow">↗</span>
        <style jsx>{`
          .agent-card-loading {
            border-color: var(--border);
            cursor: default;
          }
          .agent-card-avatar-skel {
            animation: skel-pulse 1.4s ease-in-out infinite;
          }
          .agent-card-skel-bar {
            display: inline-block;
            height: 10px;
            background: var(--border);
            border-radius: 2px;
            animation: skel-pulse 1.4s ease-in-out infinite;
          }
          .agent-card-skel-chip {
            display: inline-block;
            width: 80px;
            height: 14px;
            border: 1px solid var(--border);
            animation: skel-pulse 1.4s ease-in-out infinite;
          }
          @keyframes skel-pulse {
            0%, 100% { opacity: 0.55; }
            50% { opacity: 0.85; }
          }
          .agent-card-body { display: flex; flex-direction: column; gap: 2px; }
          .agent-card-row {
            display: flex; align-items: center; gap: 6px; white-space: nowrap;
          }
          .agent-card-avatar {
            width: 22px; height: 22px;
            background: var(--ink); color: var(--bg-elev);
            font-family: var(--font-pixel, var(--font-mono));
            font-size: 10px;
            display: grid; place-items: center;
          }
          .agent-card-arrow {
            margin-left: auto; color: var(--text-dim); font-size: 12px;
          }
          .agent-card-sep { opacity: 0.4; }
        `}</style>
      </div>
    );
  }

  if (fetchError && !data) {
    return (
      <div
        className="agent-card agent-card-loading"
        title={fetchError}
        style={{ borderColor: 'var(--accent-rose)' }}
      >
        <span className="agent-card-dot" style={{ background: 'var(--accent-rose)' }} />
        <span className="mono" style={{ color: 'var(--accent-rose)' }}>
          agent · {fetchError.slice(0, 48)}
        </span>
      </div>
    );
  }

  if (!data) return null;

  const name = data.metadata?.name ?? 'Pasillo Travel Agent';
  const shortAddr = `${data.providerAddress.slice(0, 6)}…${data.providerAddress.slice(-4)}`;

  return (
    <a
      className="agent-card"
      href={data.explorerUrl}
      target="_blank"
      rel="noreferrer"
      title="View on Arcscan"
    >
      <span className="agent-card-avatar">PS</span>
      <div className="agent-card-body">
        <div className="agent-card-row">
          <span className="agent-card-name">{name}</span>
          <span className="agent-card-badge">ERC-8004 · #{data.agentId}</span>
        </div>
        <div className="agent-card-row agent-card-meta">
          <span className="agent-card-stars">★ {data.stars.toFixed(2)}</span>
          <span className="agent-card-sep">·</span>
          <span>{data.count} feedback</span>
          <span className="agent-card-sep">·</span>
          <span>{data.validators} validators</span>
          <span className="agent-card-sep">·</span>
          <span className="mono">{shortAddr}</span>
        </div>
      </div>
      <span className="agent-card-arrow">↗</span>

      <style jsx>{`
        .agent-card {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          padding: 6px 10px;
          border: 1.5px solid var(--ink);
          background: var(--bg-elev);
          text-decoration: none;
          color: var(--text);
          font-family: var(--font-mono);
          transition: all 0.15s;
          max-width: 100%;
        }
        .agent-card:hover {
          background: color-mix(in oklab, var(--ink) 4%, var(--bg-elev));
        }
        .agent-card-loading {
          border-color: var(--border);
        }
        .agent-card-dot {
          width: 8px;
          height: 8px;
          background: var(--text-dim);
          border-radius: 50%;
          animation: blink 1s infinite;
        }
        @keyframes blink {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 1; }
        }
        .agent-card-avatar {
          width: 22px;
          height: 22px;
          background: var(--ink);
          color: var(--bg-elev);
          font-family: var(--font-pixel);
          font-size: 10px;
          display: grid;
          place-items: center;
        }
        .agent-card-body {
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
        }
        .agent-card-row {
          display: flex;
          align-items: center;
          gap: 6px;
          white-space: nowrap;
        }
        .agent-card-name {
          font-family: var(--font-sans);
          font-size: 12px;
          font-weight: 500;
          color: var(--text);
          letter-spacing: -0.005em;
        }
        .agent-card-badge {
          font-family: var(--font-mono);
          font-size: 9px;
          color: var(--ink);
          padding: 1px 6px;
          border: 1px solid var(--ink);
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .agent-card-meta {
          font-size: 10px;
          color: var(--text-dim);
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .agent-card-stars {
          color: var(--ink);
          font-weight: 500;
        }
        .agent-card-sep {
          opacity: 0.4;
        }
        .agent-card-demo {
          background: var(--accent-amber);
          color: var(--bg);
          padding: 1px 4px;
          font-size: 9px;
          font-weight: 600;
        }
        .agent-card-arrow {
          margin-left: auto;
          color: var(--text-dim);
          font-size: 12px;
        }
      `}</style>
    </a>
  );
}
