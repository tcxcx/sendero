'use client';

/**
 * DepositDialog — fund the user's MSCA on Arc Testnet.
 * Two paths: (a) Circle faucet (external), (b) treasury drip via /api/fund-msca.
 *
 * The treasury drip is dev-only — it spends real testnet treasury USDC
 * with no UX guard, so it's a foot-cannon for prod operators. The
 * Circle faucet stays available everywhere because it's external.
 */

import { useState } from 'react';
import { useQueryState } from 'nuqs';
import { DialogShell } from './dialog-shell';
import { useSendero } from './store';

const SHOW_TREASURY_DRIP = process.env.NODE_ENV === 'development';

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

      {SHOW_TREASURY_DRIP && (
        <>
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
            {busy ? (
              <>
                <span className="dlg-spinner" aria-hidden="true" />
                <span>Sending drip…</span>
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
                  <path
                    d="M12 3v14m0 0l-5-5m5 5l5-5M5 21h14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span>Drip {amt || '0'} USDC from treasury</span>
              </>
            )}
          </button>
        </>
      )}

      <a
        className="dlg-primary dlg-primary-ghost"
        href={faucetHref}
        target="_blank"
        rel="noreferrer"
        style={{ textDecoration: 'none' }}
      >
        <span>Circle faucet</span>
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
        <span style={{ opacity: 0.6, marginLeft: 4 }}>· 20 USDC per drip</span>
      </a>
    </DialogShell>
  );
}
