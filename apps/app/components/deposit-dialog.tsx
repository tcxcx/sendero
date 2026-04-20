'use client';

/**
 * DepositDialog — fund the user's MSCA on Arc Testnet.
 * Two paths: (a) Circle faucet (external), (b) treasury drip via /api/fund-msca.
 */

import { useState } from 'react';
import { useQueryState } from 'nuqs';
import { DialogShell, dialogStyles } from './dialog-shell';
import { useSendero } from './store';

export function DepositDialog() {
  const [deposit, setDeposit] = useQueryState('deposit');
  const [amount, setAmount] = useQueryState('dripAmount', { defaultValue: '5' });
  const userAuth = useSendero(s => s.userAuth);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const open = deposit === 'open';
  const close = () => {
    setDeposit(null);
    setError(null);
    setResult(null);
    setBusy(false);
  };

  const amt = amount || '';
  const amtNum = Number(amt);
  const validAmt = Number.isFinite(amtNum) && amtNum >= 0.1 && amtNum <= 20;

  const drip = async () => {
    if (!userAuth || !validAmt || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/fund-msca', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: userAuth.address, amount: amt }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message || data?.error || `fund_failed (${res.status})`);
      }
      setResult(
        `Drip submitted · ${data.amount} USDC → ${userAuth.address.slice(0, 6)}…${userAuth.address.slice(-4)}.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!userAuth) return null;
  const faucetHref = `https://faucet.circle.com/?address=${userAuth.address}`;

  return (
    <DialogShell
      open={open}
      title="Deposit · fund your wallet"
      subtitle="Arc Testnet · 1–20 USDC"
      onClose={close}
    >
      <p className="dlg-sub">
        Your passkey MSCA (
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink)' }}>
          {userAuth.address.slice(0, 6)}…{userAuth.address.slice(-4)}
        </span>
        ) needs USDC on Arc Testnet. Choose a source.
      </p>

      <div className="dlg-row">
        <span className="dlg-label">Treasury drip amount · USDC</span>
        <input
          className="dlg-input"
          style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}
          inputMode="decimal"
          value={amt}
          onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
          placeholder="5"
        />
      </div>

      {error && <div className="dlg-err">{error}</div>}
      {result && <div className="dlg-ok">{result}</div>}

      <button type="button" className="dlg-primary" disabled={!validAmt || busy} onClick={drip}>
        {busy ? 'Sending…' : `🚰 Drip ${amt || '0'} USDC from treasury`}
      </button>

      <a
        className="dlg-primary"
        href={faucetHref}
        target="_blank"
        rel="noreferrer"
        style={{
          background: 'var(--bg-elev)',
          color: 'var(--ink)',
          border: '1.5px solid var(--ink)',
          textAlign: 'center',
          textDecoration: 'none',
          marginTop: 2,
        }}
      >
        Circle faucet ↗ · 20 USDC per drip
      </a>

      <style jsx global>
        {dialogStyles}
      </style>
    </DialogShell>
  );
}
