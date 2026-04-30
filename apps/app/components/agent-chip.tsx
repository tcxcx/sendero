'use client';

/**
 * AgentChip — compact representation of the Sendero travel agent's
 * ERC-8004 identity. Click to expand into a popover with the full card
 * (stars, feedback count, validators, arcscan link).
 */

import { useEffect, useRef, useState } from 'react';

import {
  ReputationStatDialog,
  type ReputationRecentFeedback,
  type ReputationValidation,
} from '@/components/reputation-stat-dialog';

interface AgentIdentity {
  agentId: string;
  providerAddress: string;
  stars: number;
  meanScore: number;
  count: number;
  validators: number;
  metadata: { name?: string; description?: string } | null;
  indexed: {
    contract: string;
    holderAddress: string;
    status: string;
    mintedAt: string | null;
    cachedAt: string | null;
  } | null;
  recent: ReputationRecentFeedback[];
  validations: ReputationValidation[];
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

  // `g x` hotkey → open Arcscan in a new tab. The shortcut is registered
  // globally in `useAppHotkeys`; that hook dispatches a CustomEvent we
  // resolve here against the current `data.explorerUrl`.
  useEffect(() => {
    const onHotkey = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (detail !== 'open-arcscan') return;
      if (!data?.explorerUrl) return;
      window.open(data.explorerUrl, '_blank', 'noopener,noreferrer');
    };
    window.addEventListener('sendero:hotkey', onHotkey);
    return () => window.removeEventListener('sendero:hotkey', onHotkey);
  }, [data?.explorerUrl]);

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

  const name = data.metadata?.name ?? 'Sendero Travel Agent';
  const shortAddr = `${data.providerAddress.slice(0, 6)}…${data.providerAddress.slice(-4)}`;

  return (
    <div className="ac-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`sd-corner-hover ac-chip ${open ? 'open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
      >
        <span className="ac-avatar">PS</span>
        <span className="ac-stars">★ {data.stars.toFixed(2)}</span>
        <span className="ac-id">#{data.agentId}</span>
        <span className={`ac-chev ${open ? 'open' : ''}`} aria-hidden="true">
          ▾
        </span>
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
            <ReputationStatDialog
              identity={{
                kind: 'sendero-agent',
                name,
                agentId: data.agentId,
                status: data.indexed?.status ?? null,
                providerAddress: data.providerAddress,
                holderAddress: data.indexed?.holderAddress ?? null,
                contract: data.indexed?.contract ?? null,
                explorerUrl: data.explorerUrl,
                mintedAt: data.indexed?.mintedAt ?? null,
                cachedAt: data.indexed?.cachedAt ?? null,
              }}
              metric={{
                key: 'stars',
                label: 'stars',
                value: data.stars.toFixed(2),
                description:
                  'Weighted ERC-8004 reputation signal for the Sendero travel agent across recorded trip feedback.',
              }}
              recent={data.recent}
              validations={data.validations}
            >
              <StatBox value={`★ ${data.stars.toFixed(2)}`} label="stars" />
            </ReputationStatDialog>
            <ReputationStatDialog
              identity={{
                kind: 'sendero-agent',
                name,
                agentId: data.agentId,
                status: data.indexed?.status ?? null,
                providerAddress: data.providerAddress,
                holderAddress: data.indexed?.holderAddress ?? null,
                contract: data.indexed?.contract ?? null,
                explorerUrl: data.explorerUrl,
                mintedAt: data.indexed?.mintedAt ?? null,
                cachedAt: data.indexed?.cachedAt ?? null,
              }}
              metric={{
                key: 'feedback',
                label: 'feedback',
                value: String(data.count),
                description:
                  'Feedback events indexed for this agent, including linked trip and booking references when the event was created by a Sendero trip interaction.',
              }}
              recent={data.recent}
              validations={data.validations}
            >
              <StatBox value={String(data.count)} label="feedback" />
            </ReputationStatDialog>
            <ReputationStatDialog
              identity={{
                kind: 'sendero-agent',
                name,
                agentId: data.agentId,
                status: data.indexed?.status ?? null,
                providerAddress: data.providerAddress,
                holderAddress: data.indexed?.holderAddress ?? null,
                contract: data.indexed?.contract ?? null,
                explorerUrl: data.explorerUrl,
                mintedAt: data.indexed?.mintedAt ?? null,
                cachedAt: data.indexed?.cachedAt ?? null,
              }}
              metric={{
                key: 'validators',
                label: 'validators',
                value: String(data.validators),
                description:
                  'Distinct validator wallets that have rated or attested the Sendero travel agent under the ERC-8004 reputation graph.',
              }}
              recent={data.recent}
              validations={data.validations}
            >
              <StatBox value={String(data.validators)} label="validators" />
            </ReputationStatDialog>
            <ReputationStatDialog
              identity={{
                kind: 'sendero-agent',
                name,
                agentId: data.agentId,
                status: data.indexed?.status ?? null,
                providerAddress: data.providerAddress,
                holderAddress: data.indexed?.holderAddress ?? null,
                contract: data.indexed?.contract ?? null,
                explorerUrl: data.explorerUrl,
                mintedAt: data.indexed?.mintedAt ?? null,
                cachedAt: data.indexed?.cachedAt ?? null,
              }}
              metric={{
                key: 'mean-score',
                label: 'mean score',
                value: data.meanScore.toFixed(0),
                description:
                  'Mean raw ERC-8004 score on the 0-100 scale before conversion into the visible 0-5 star value.',
              }}
              recent={data.recent}
              validations={data.validations}
            >
              <StatBox value={data.meanScore.toFixed(0)} label="mean score" />
            </ReputationStatDialog>
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
            title="Open Arcscan (g x)"
          >
            View on Arcscan ↗
            <kbd className="ac-kbd" aria-hidden>
              g x
            </kbd>
          </a>
        </div>
      )}

      <style jsx>{chipStyles}</style>
    </div>
  );
}

function StatBox({ value, label }: { value: string; label: string }) {
  return (
    <button type="button" className="ac-stat reputation-stat-trigger">
      <div className="ac-stat-v">{value}</div>
      <div className="ac-stat-k">{label}</div>
    </button>
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
    gap: 6px;
    /* Header baseline — all right-side chips lock to 28px so the
       top and bottom lines cleanly tangent all controls. */
    height: 28px;
    padding: 0 8px 0 4px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: 10px;
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
    width: 20px;
    height: 20px;
    background: var(--ink);
    color: var(--bg-elev);
    font-family: var(--font-mono);
    font-size: 9px;
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
  .ac-chev {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--ink);
    transition: transform 160ms ease;
    margin-left: 2px;
  }
  .ac-chev.open {
    transform: rotate(-180deg);
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
    border: 0;
    background: transparent;
    padding: 10px 6px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    align-items: center;
    border-right: 1px solid var(--border);
    cursor: pointer;
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
