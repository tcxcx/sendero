'use client';

/**
 * BridgeDialog — bridge USDC INTO Arc Testnet from any supported chain
 * via Circle App Kit (CCTP). State lives in
 * `?bridge=open&fromChain=Ethereum_Sepolia&amount=1.00`.
 */

import { useState } from 'react';
import { useQueryState } from 'nuqs';
import { DialogShell } from './dialog-shell';
import { TokenIcon, BlockchainIcon } from '@sendero/icons';
import {
  ARC_BRIDGE_SOURCES,
  bridgeChainLabel,
  type ArcBridgeSource,
} from '@sendero/arc/bridge-chains';

export function BridgeDialog() {
  const [bridge, setBridge] = useQueryState('bridge');
  const [fromChain, setFromChain] = useQueryState('fromChain', {
    defaultValue: 'Ethereum_Sepolia',
  });
  const [amount, setAmount] = useQueryState('amount', { defaultValue: '1' });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<
    Array<{
      name: string;
      state: string;
      txHash?: string;
      explorerUrl?: string;
    }>
  >([]);

  const open = bridge === 'open';
  const close = () => {
    setBridge(null);
    setError(null);
    setSteps([]);
    setBusy(false);
  };

  const chain = (fromChain as ArcBridgeSource) || 'Ethereum_Sepolia';
  const amt = amount || '';
  const amtNum = Number(amt);
  const valid = Number.isFinite(amtNum) && amtNum > 0 && amtNum <= 1000;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    setSteps([]);
    try {
      const res = await fetch('/api/bridge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromChain: chain, amount: amt }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message || data?.error || `bridge_failed (${res.status})`);
      }
      setSteps(Array.isArray(data.steps) ? data.steps : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogShell
      open={open}
      title="Bridge · → Arc Testnet"
      subtitle="Circle CCTP v2 · cross-chain"
      onClose={close}
    >
      <p className="dlg-sub">
        Moves USDC from your unified Gateway balance across enabled Gateway chains. Arc remains the
        default destination while Solana and other chain destinations come online.
      </p>

      {/* Live route visualization — updates as chain selection changes */}
      <div className="br-route">
        <div className="br-route-end">
          <BlockchainIcon chain={chain} size={20} />
          <span className="br-route-label">{bridgeChainLabel(chain)}</span>
        </div>
        <svg className="br-arrow" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path
            d="M5 12h14m0 0l-5-5m5 5l-5 5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <div className="br-route-end">
          <BlockchainIcon chain="Arc_Testnet" size={20} />
          <span className="br-route-label">Arc Testnet</span>
        </div>
        <span className="br-token-pill">
          <TokenIcon token="USDC" size={13} />
          <span>USDC</span>
        </span>
      </div>

      <div className="dlg-row">
        <span className="dlg-label">Source chain · Gateway balance</span>
        <div className="br-chain-grid" role="radiogroup" aria-label="Source chain">
          {ARC_BRIDGE_SOURCES.map(id => {
            const selected = id === chain;
            return (
              <button
                key={id}
                type="button"
                className={`br-chain-card ${selected ? 'selected' : ''}`}
                role="radio"
                aria-checked={selected}
                onClick={() => setFromChain(id)}
              >
                <BlockchainIcon chain={id} size={18} />
                <span>{bridgeChainLabel(id)}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="dlg-row">
        <span className="dlg-label">Destination</span>
        <div className="br-destination-card">
          <BlockchainIcon chain="Arc_Testnet" size={18} />
          <span>Arc Testnet</span>
          <em>default Gateway settlement rail</em>
        </div>
      </div>

      <div className="dlg-row">
        <span className="dlg-label">Amount · USDC</span>
        <div className="br-amount-row">
          <TokenIcon token="USDC" size={14} />
          <input
            className="dlg-input"
            style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', flex: 1 }}
            inputMode="decimal"
            value={amt}
            onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
            placeholder="0.00"
          />
        </div>
      </div>

      {error && <div className="dlg-err">{error}</div>}
      {steps.length > 0 && (
        <div className="dlg-ok">
          <strong>
            Bridge submitted — {steps.length} step{steps.length !== 1 && 's'}.
          </strong>
          <div className="br-steps">
            {steps.map((s, i) => (
              <div key={i} className="br-step">
                <span
                  style={{
                    color:
                      s.state === 'success'
                        ? 'var(--accent-green)'
                        : s.state === 'error'
                          ? 'var(--accent-rose)'
                          : 'var(--text-dim)',
                    fontSize: 8,
                  }}
                >
                  ●
                </span>
                <span style={{ color: 'var(--text-dim)' }}>
                  {s.name} · {s.state}
                </span>
                {s.explorerUrl && s.txHash && (
                  <a className="dlg-link" href={s.explorerUrl} target="_blank" rel="noreferrer">
                    {s.txHash.slice(0, 8)}…{s.txHash.slice(-4)} ↗
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <button type="button" className="dlg-primary" disabled={!valid || busy} onClick={submit}>
        {busy ? (
          <>
            <span className="dlg-spinner" aria-hidden="true" />
            <span>Signing + mint…</span>
          </>
        ) : (
          <>
            <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
              <path
                d="M4 17c4-8 12-8 16 0M4 17l3-2m-3 2l2 3M20 17l-3-2m3 2l-2 3"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>
              Bridge {amt || '0'} USDC · {bridgeChainLabel(chain)} → Arc
            </span>
          </>
        )}
      </button>

      <style jsx>{`
        .br-route {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 12px;
          border: 1px solid var(--border);
          background: var(--bg-elev);
        }
        .br-route-end {
          display: flex;
          align-items: center;
          gap: 6px;
          flex: 1;
          min-width: 0;
        }
        .br-route-label {
          font-family: var(--font-mono);
          font-size: 10px;
          letter-spacing: 0.06em;
          color: var(--text);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .br-arrow {
          color: var(--text-faint);
          flex-shrink: 0;
        }
        .br-token-pill {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-family: var(--font-mono);
          font-size: 9.5px;
          letter-spacing: 0.1em;
          color: var(--text-dim);
          padding: 2px 7px;
          border: 1px solid var(--border);
          background: var(--bg);
          flex-shrink: 0;
        }
        .br-chain-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
          width: 100%;
        }
        .br-chain-card,
        .br-destination-card {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
          border: 1px solid var(--border);
          background: var(--bg-elev);
          color: var(--text);
          padding: 10px 11px;
          font-family: var(--font-mono);
          font-size: 10.5px;
          letter-spacing: 0.05em;
          text-align: left;
        }
        .br-chain-card {
          cursor: pointer;
          transition:
            border-color 140ms ease,
            background-color 140ms ease,
            color 140ms ease;
        }
        .br-chain-card:hover,
        .br-chain-card.selected {
          border-color: var(--ink);
          background: color-mix(in oklab, var(--ink) 8%, var(--bg-elev));
          color: var(--ink);
        }
        .br-chain-card span,
        .br-destination-card span {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .br-destination-card {
          width: 100%;
          border-color: color-mix(in oklab, var(--ink) 30%, var(--border));
        }
        .br-destination-card em {
          margin-left: auto;
          color: var(--text-dim);
          font-style: normal;
          font-size: 9px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .br-amount-row {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
        }
        .br-steps {
          margin-top: 8px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .br-step {
          display: grid;
          grid-template-columns: auto 1fr auto;
          gap: 8px;
          align-items: center;
        }
        @media (max-width: 560px) {
          .br-chain-grid {
            grid-template-columns: 1fr;
          }
          .br-destination-card {
            align-items: flex-start;
            flex-direction: column;
          }
          .br-destination-card em {
            margin-left: 0;
          }
        }
      `}</style>
    </DialogShell>
  );
}
