'use client';

/**
 * DepositDialog — gateway-focused deposit instructions.
 *
 * Shows the operator's per-chain deposit addresses for USDC (via Circle
 * Gateway unified balance) and EURC (direct on-chain). Three chains:
 * Arc Testnet, Avalanche Fuji, Solana Devnet.
 *
 * USDC deposits pool into the unified Gateway balance visible in the
 * UnifiedBalanceSection. EURC deposits land directly on each chain's
 * balance independently (no pooling).
 *
 * Dev-only: treasury drip to MSCA is still available via a collapsed
 * section when NODE_ENV === 'development'.
 */

import { useState, useEffect, useCallback } from 'react';
import { useQueryState } from 'nuqs';
import { DialogShell } from './dialog-shell';
import { TokenIcon, BlockchainIcon } from '@sendero/icons';
import { useSendero } from './store';

type Token = 'USDC' | 'EURC';

interface DepositChain {
  chain: string;
  label: string;
  kind: 'evm' | 'solana';
  address: string | null;
}

interface DepositInfo {
  usdc: DepositChain[];
  eurc: DepositChain[];
}

const SHOW_TREASURY_DRIP = process.env.NODE_ENV === 'development';

export function DepositDialog() {
  const [deposit, setDeposit] = useQueryState('deposit');
  const userAuth = useSendero(s => s.userAuth);

  const [selectedToken, setSelectedToken] = useState<Token>('USDC');
  const [info, setInfo] = useState<DepositInfo | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // Dev-only drip state
  const [dripAmount, setDripAmount] = useQueryState('dripAmount', { defaultValue: '5' });
  const [dripBusy, setDripBusy] = useState(false);
  const [dripResult, setDripResult] = useState<string | null>(null);
  const [dripError, setDripError] = useState<string | null>(null);

  const open = deposit === 'open';

  const close = () => {
    setDeposit(null);
    setDripResult(null);
    setDripError(null);
    setDripBusy(false);
  };

  // Fetch deposit addresses whenever the dialog opens
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setInfoError(null);
    fetch('/api/gateway/deposit-info', { cache: 'no-store' })
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        if (data?.error) {
          setInfoError(data.message ?? data.error);
        } else {
          setInfo(data as DepositInfo);
        }
      })
      .catch(err => {
        if (!cancelled) setInfoError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const copyAddress = useCallback(async (address: string) => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(address);
      setTimeout(() => setCopied(addr => (addr === address ? null : addr)), 1600);
    } catch {
      /* clipboard unavailable */
    }
  }, []);

  const chains: DepositChain[] = selectedToken === 'USDC' ? (info?.usdc ?? []) : (info?.eurc ?? []);

  // Dev drip
  const amt = dripAmount || '';
  const amtNum = Number(amt);
  const validAmt = Number.isFinite(amtNum) && amtNum >= 0.1 && amtNum <= 20;

  const drip = async () => {
    if (!userAuth || !validAmt || dripBusy) return;
    setDripBusy(true);
    setDripError(null);
    setDripResult(null);
    try {
      const res = await fetch('/api/fund-msca', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: userAuth.address, amount: amt }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || data?.error || `fund_failed (${res.status})`);
      setDripResult(
        `Drip sent · ${data.amount} USDC → ${userAuth.address.slice(0, 6)}…${userAuth.address.slice(-4)}`
      );
    } catch (err) {
      setDripError(err instanceof Error ? err.message : String(err));
    } finally {
      setDripBusy(false);
    }
  };

  if (!userAuth) return null;

  return (
    <DialogShell
      open={open}
      title="Deposit"
      subtitle="Gateway · Arc · Avalanche · Solana"
      onClose={close}
    >
      <p className="dlg-sub">
        Send to your deposit address on any chain below. USDC pools into your{' '}
        <strong>unified Gateway balance</strong>. EURC lands directly per chain.
      </p>

      {/* Token selector */}
      <div className="dep-tabs">
        {(['USDC', 'EURC'] as Token[]).map(t => (
          <button
            key={t}
            type="button"
            className={`dep-tab ${selectedToken === t ? 'sel' : ''}`}
            onClick={() => setSelectedToken(t)}
          >
            <TokenIcon token={t} size={15} />
            <span>{t}</span>
            {t === 'USDC' && <span className="dep-tab-note">unified</span>}
            {t === 'EURC' && <span className="dep-tab-note">per chain</span>}
          </button>
        ))}
      </div>

      {/* Error loading addresses */}
      {infoError && (
        <div className="dlg-err">
          {/not_configured|not_provisioned/.test(infoError)
            ? 'Gateway not provisioned yet — check back in a moment.'
            : infoError}
        </div>
      )}

      {/* Chain rows */}
      {!infoError && (
        <div className="dep-chains">
          {chains.length === 0 &&
            // Skeleton rows while loading
            [0, 1, 2].map(i => <div key={i} className="dep-chain-skel" />)}

          {chains.map(chain => (
            <div key={chain.chain} className="dep-chain-row">
              <div className="dep-chain-head">
                <BlockchainIcon chain={chain.chain} size={22} />
                <span className="dep-chain-label">{chain.label}</span>
                <span className="dep-token-pill">
                  <TokenIcon token={selectedToken} size={13} />
                  <span>{selectedToken}</span>
                </span>
              </div>

              {chain.address ? (
                <div className="dep-addr-row">
                  <code className="dep-addr">{chain.address}</code>
                  <button
                    type="button"
                    className={`dep-copy ${copied === chain.address ? 'copied' : ''}`}
                    onClick={() => copyAddress(chain.address!)}
                    aria-label={`Copy ${chain.label} deposit address`}
                  >
                    {copied === chain.address ? (
                      <>
                        <svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true">
                          <path
                            d="M5 13l4 4L19 7"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                        Copied
                      </>
                    ) : (
                      <>
                        <svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true">
                          <rect
                            x="9"
                            y="9"
                            width="13"
                            height="13"
                            rx="2"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                          />
                          <path
                            d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                          />
                        </svg>
                        Copy
                      </>
                    )}
                  </button>
                </div>
              ) : (
                <div className="dep-unavail">
                  <span>Phase 4 · not provisioned yet</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Faucet CTA */}
      <a
        className="dlg-primary dlg-primary-ghost"
        href="https://faucet.circle.com/"
        target="_blank"
        rel="noreferrer"
        style={{ textDecoration: 'none' }}
      >
        <span>Circle testnet faucet</span>
        <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
          <path
            d="M7 17L17 7M9 7h8v8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span style={{ opacity: 0.55, marginLeft: 4 }}>· free testnet USDC</span>
      </a>

      {/* Dev-only: treasury drip to MSCA */}
      {SHOW_TREASURY_DRIP && userAuth && (
        <details className="dep-dev-details">
          <summary className="dep-dev-summary">Dev · MSCA drip</summary>
          <div className="dep-dev-body">
            <div className="dlg-row">
              <span className="dlg-label">Amount · USDC (0.1–20)</span>
              <input
                className="dlg-input"
                style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}
                inputMode="decimal"
                value={amt}
                onChange={e => setDripAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                placeholder="5"
              />
            </div>
            {dripError && <div className="dlg-err">{dripError}</div>}
            {dripResult && <div className="dlg-ok">{dripResult}</div>}
            <button
              type="button"
              className="dlg-primary"
              disabled={!validAmt || dripBusy}
              onClick={drip}
            >
              {dripBusy ? (
                <>
                  <span className="dlg-spinner" aria-hidden="true" />
                  <span>Sending drip…</span>
                </>
              ) : (
                <span>Drip {amt || '0'} USDC → MSCA</span>
              )}
            </button>
          </div>
        </details>
      )}

      <style jsx>{`
        .dep-tabs {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 6px;
        }
        .dep-tab {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 8px 12px;
          border: 1.5px solid var(--border);
          background: var(--bg);
          color: var(--text-dim);
          font-family: var(--font-mono);
          font-size: 11px;
          letter-spacing: 0.08em;
          font-weight: 500;
          cursor: pointer;
          transition: border-color 120ms, color 120ms, background 120ms;
        }
        .dep-tab:hover {
          border-color: var(--text-dim);
          color: var(--text);
        }
        .dep-tab.sel {
          border-color: var(--ink);
          color: var(--ink);
          background: color-mix(in oklab, var(--ink) 4%, var(--bg));
        }
        .dep-tab-note {
          margin-left: auto;
          font-size: 9px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--text-faint);
          white-space: nowrap;
        }
        .dep-tab.sel .dep-tab-note {
          color: var(--text-dim);
        }

        .dep-chains {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .dep-chain-skel {
          height: 72px;
          background: color-mix(in oklab, var(--border) 60%, transparent);
          border-radius: 2px;
          animation: dep-pulse 1.4s ease-in-out infinite;
        }
        @keyframes dep-pulse {
          0%, 100% { opacity: 0.4; }
          50%       { opacity: 0.7; }
        }
        .dep-chain-row {
          border: 1px solid var(--border);
          background: color-mix(in oklab, var(--bg-elev) 100%, transparent);
          padding: 10px 12px;
          display: flex;
          flex-direction: column;
          gap: 7px;
          transition: border-color 120ms;
        }
        .dep-chain-row:hover {
          border-color: var(--text-dim);
        }
        .dep-chain-head {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .dep-chain-label {
          font-family: var(--font-mono);
          font-size: 11px;
          font-weight: 500;
          letter-spacing: 0.06em;
          color: var(--text);
          flex: 1;
          min-width: 0;
        }
        .dep-token-pill {
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
        }
        .dep-addr-row {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 8px;
          align-items: center;
        }
        .dep-addr {
          font-family: var(--font-mono);
          font-size: 10px;
          letter-spacing: 0.04em;
          color: var(--text-dim);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          min-width: 0;
        }
        .dep-copy {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 4px 9px;
          border: 1px solid var(--border);
          background: var(--bg);
          color: var(--text-dim);
          font-family: var(--font-mono);
          font-size: 10px;
          letter-spacing: 0.08em;
          cursor: pointer;
          white-space: nowrap;
          transition: border-color 120ms, color 120ms, background 120ms;
          flex-shrink: 0;
        }
        .dep-copy:hover {
          border-color: var(--ink);
          color: var(--ink);
          background: color-mix(in oklab, var(--ink) 4%, var(--bg));
        }
        .dep-copy.copied {
          border-color: var(--accent-green, #22c55e);
          color: var(--accent-green, #22c55e);
          background: color-mix(in oklab, var(--accent-green, #22c55e) 6%, var(--bg));
        }
        .dep-unavail {
          font-family: var(--font-mono);
          font-size: 10px;
          letter-spacing: 0.06em;
          color: var(--text-faint);
          padding: 2px 0;
        }

        .dep-dev-details {
          border-top: 1px solid var(--border);
          padding-top: 10px;
        }
        .dep-dev-summary {
          font-family: var(--font-mono);
          font-size: 10px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--text-faint);
          cursor: pointer;
          user-select: none;
          list-style: none;
        }
        .dep-dev-summary::-webkit-details-marker {
          display: none;
        }
        .dep-dev-summary::before {
          content: '▸ ';
        }
        details[open] .dep-dev-summary::before {
          content: '▾ ';
        }
        .dep-dev-body {
          margin-top: 10px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
      `}</style>
    </DialogShell>
  );
}
