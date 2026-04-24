'use client';

/**
 * SendDialog — same-chain USDC / EURC transfer from the Sendero treasury.
 * State lives in `?send=open&token=USDC&to=0x...&amount=1.00`.
 */

import { useState } from 'react';
import { useQueryState } from 'nuqs';
import { DialogShell } from './dialog-shell';

type Token = 'USDC' | 'EURC';

export function SendDialog() {
  const [send, setSend] = useQueryState('send');
  const [token, setToken] = useQueryState('token', { defaultValue: 'USDC' });
  const [to, setTo] = useQueryState('to', { defaultValue: '' });
  const [amount, setAmount] = useQueryState('amount', { defaultValue: '1' });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    txHash: string | null;
    explorerUrl: string | null;
  } | null>(null);

  const open = send === 'open';
  const close = () => {
    setSend(null);
    setError(null);
    setResult(null);
    setBusy(false);
  };

  const tok = (token as Token) || 'USDC';
  const toAddr = (to || '').trim();
  const amt = amount || '';
  const amtNum = Number(amt);
  const validTo = /^0x[a-fA-F0-9]{40}$/.test(toAddr);
  const validAmt = Number.isFinite(amtNum) && amtNum > 0 && amtNum <= 10_000;
  const valid = validTo && validAmt;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tok, to: toAddr, amount: amt }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message || data?.error || `send_failed (${res.status})`);
      }
      setResult({
        txHash: data.txHash ?? null,
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
      title="Send · treasury transfer"
      subtitle="Arc Testnet · same-chain"
      onClose={close}
    >
      <p className="dlg-sub">
        Sends {tok} from the Sendero treasury to any Arc Testnet address. Gas paid in Arc-native
        USDC.
      </p>

      <div className="dlg-row">
        <span className="dlg-label">Token</span>
        <div className="dlg-segmented">
          {(['USDC', 'EURC'] as Token[]).map(t => (
            <button
              key={t}
              type="button"
              className={`dlg-seg-btn ${tok === t ? 'sel' : ''}`}
              onClick={() => setToken(t)}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="dlg-row">
        <span className="dlg-label">Recipient (0x…40)</span>
        <input
          className="dlg-input"
          style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
          value={toAddr}
          onChange={e => setTo(e.target.value)}
          placeholder="0xabcd...1234"
          spellCheck={false}
        />
      </div>

      <div className="dlg-row">
        <span className="dlg-label">Amount</span>
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
      {result && (
        <div className="dlg-ok">
          <strong>Sent.</strong>{' '}
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
            <span>Signing transaction…</span>
          </>
        ) : (
          <>
            <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
              <path
                d="M5 12h14m0 0l-5-5m5 5l-5 5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>
              Send {amt || '0'} {tok} →{' '}
              {validTo ? `${toAddr.slice(0, 6)}…${toAddr.slice(-4)}` : '—'}
            </span>
          </>
        )}
      </button>
    </DialogShell>
  );
}
