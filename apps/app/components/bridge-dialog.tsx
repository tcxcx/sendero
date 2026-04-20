'use client';

/**
 * BridgeDialog — bridge USDC INTO Arc Testnet from any supported chain
 * via Circle App Kit (CCTP). State lives in
 * `?bridge=open&fromChain=Ethereum_Sepolia&amount=1.00`.
 */

import { useState } from 'react';
import { useQueryState } from 'nuqs';
import { DialogShell, dialogStyles } from './dialog-shell';
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
        Pulls USDC from another supported chain into Arc Testnet via Circle CCTP. Treasury wallet is
        both source and destination for the demo.
      </p>

      <div className="dlg-row">
        <span className="dlg-label">Source chain</span>
        <select className="dlg-select" value={chain} onChange={e => setFromChain(e.target.value)}>
          {ARC_BRIDGE_SOURCES.map(id => (
            <option key={id} value={id}>
              {bridgeChainLabel(id)}
            </option>
          ))}
        </select>
      </div>

      <div className="dlg-row">
        <span className="dlg-label">Amount · USDC</span>
        <input
          className="dlg-input"
          style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}
          inputMode="decimal"
          value={amt}
          onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
          placeholder="0.00"
        />
      </div>

      {error && <div className="dlg-err">{error}</div>}
      {steps.length > 0 && (
        <div className="dlg-ok">
          <strong>
            Bridge submitted — {steps.length} step{steps.length !== 1 && 's'}.
          </strong>
          <div
            style={{
              marginTop: 8,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            {steps.map((s, i) => (
              <div
                key={i}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr auto',
                  gap: 8,
                  alignItems: 'center',
                }}
              >
                <span
                  style={{
                    color:
                      s.state === 'success'
                        ? 'var(--accent-green)'
                        : s.state === 'error'
                          ? 'var(--accent-rose)'
                          : 'var(--text-dim)',
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
        {busy ? 'Signing + mint…' : `Bridge ${amt || '0'} USDC · ${bridgeChainLabel(chain)} → Arc`}
      </button>

      <style jsx global>
        {dialogStyles}
      </style>
    </DialogShell>
  );
}
