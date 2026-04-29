'use client';

/**
 * SwapDialog — USDC ↔ EURC treasury rebalance via Circle App Kit.
 * State lives in `?swap=open&from=USDC&to=EURC&amount=5`.
 */

import { useState } from 'react';
import { useQueryState } from 'nuqs';
import { DialogShell } from './dialog-shell';

type Token = 'USDC' | 'EURC';

export function SwapDialog() {
  const [swap, setSwap] = useQueryState('swap');
  const [from, setFrom] = useQueryState('from', { defaultValue: 'USDC' });
  const [to, setTo] = useQueryState('to', { defaultValue: 'EURC' });
  const [amount, setAmount] = useQueryState('amount', { defaultValue: '5' });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    txHash: string | null;
    amountOut: string | null;
    explorerUrl: string | null;
  } | null>(null);

  const open = swap === 'open';
  const close = () => {
    setSwap(null);
    setError(null);
    setResult(null);
    setBusy(false);
  };

  const fromT = (from as Token) || 'USDC';
  const toT = (to as Token) || 'EURC';
  const amt = amount || '';
  const amountNum = Number(amt);
  const valid = Number.isFinite(amountNum) && amountNum > 0 && amountNum <= 500 && fromT !== toT;

  const flip = () => {
    setFrom(toT);
    setTo(fromT);
  };

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: fromT, to: toT, amount: amt }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message || data?.error || `swap_failed (${res.status})`);
      }
      setResult({
        txHash: data.txHash ?? null,
        amountOut: data.amountOut ?? null,
        explorerUrl: data.explorerUrl ?? null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogShell
      open={open}
      title="Swap"
      subtitle="Circle App Kit · Arc Testnet"
      onClose={close}
    >
      <p className="dlg-sub">
        Swap between USDC and EURC on Arc. Gas paid in Arc-native USDC.
      </p>

      <div className="dlg-row">
        <span className="dlg-label">From</span>
        <div className="sw-row">
          <div className="dlg-segmented">
            {(['USDC', 'EURC'] as Token[]).map(t => (
              <button
                key={t}
                type="button"
                className={`dlg-seg-btn ${fromT === t ? 'sel' : ''}`}
                disabled={toT === t}
                onClick={() => setFrom(t)}
              >
                {t}
              </button>
            ))}
          </div>
          <input
            className="dlg-input dlg-amount"
            inputMode="decimal"
            value={amt}
            onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
            placeholder="0.00"
          />
        </div>
      </div>

      <button type="button" className="sw-flip" onClick={flip} aria-label="swap direction">
        ⇅
      </button>

      <div className="dlg-row">
        <span className="dlg-label">To</span>
        <div className="sw-row">
          <div className="dlg-segmented">
            {(['USDC', 'EURC'] as Token[]).map(t => (
              <button
                key={t}
                type="button"
                className={`dlg-seg-btn ${toT === t ? 'sel' : ''}`}
                disabled={fromT === t}
                onClick={() => setTo(t)}
              >
                {t}
              </button>
            ))}
          </div>
          <input className="dlg-input dlg-amount" value={valid ? amt : '—'} readOnly />
        </div>
      </div>

      {error && <div className="dlg-err">{error}</div>}
      {result && (
        <div className="dlg-ok">
          <strong>Swap submitted.</strong>{' '}
          {result.amountOut && (
            <>
              Received {result.amountOut} {toT}.{' '}
            </>
          )}
          {result.txHash && result.explorerUrl && (
            <a className="dlg-link" href={result.explorerUrl} target="_blank" rel="noreferrer">
              {result.txHash.slice(0, 10)}…{result.txHash.slice(-6)} ↗
            </a>
          )}
        </div>
      )}

      <button type="button" className="dlg-primary" disabled={!valid || busy} onClick={submit}>
        {busy ? (
          <>
            <span className="dlg-spinner" aria-hidden="true" />
            <span>Signing…</span>
          </>
        ) : (
          <>
            <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
              <path
                d="M7 10h10l-3-3m3 3l-3 3M17 14H7l3 3m-3-3l3-3"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>
              Swap {amt || '0'} {fromT} → {toT}
            </span>
          </>
        )}
      </button>

      <style jsx>{`
        .sw-row {
          display: grid;
          grid-template-columns: 140px 1fr;
          gap: 8px;
        }
        .dlg-amount {
          text-align: right;
          font-family: var(--font-mono);
        }
        .sw-flip {
          margin: -6px auto;
          width: 32px;
          height: 32px;
          border-radius: 50%;
          border: 1.5px solid var(--ink);
          background: var(--bg-elev);
          color: var(--ink);
          cursor: pointer;
          font-size: 13px;
          align-self: center;
          line-height: 1;
          transition: transform 180ms;
        }
        .sw-flip:hover {
          transform: rotate(180deg);
        }
      `}</style>
    </DialogShell>
  );
}
