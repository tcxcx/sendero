'use client';

/**
 * SendDialog — same-chain USDC / EURC transfer from the Sendero treasury.
 * State lives in `?send=open&token=USDC&to=0x...&amount=1.00`.
 */

import { useEffect, useState } from 'react';

import { TokenIcon } from '@sendero/icons';
import { useQueryState } from 'nuqs';

import { decimalUsdcToMicro, microUsdcToDecimal } from '@/lib/gateway-balance-math';

import { DialogShell } from './dialog-shell';

type Token = 'USDC' | 'EURC';

interface GatewayBalanceSnapshot {
  grandTotal?: string;
  spendableTotal?: string;
  available?: string;
  spendableAvailable?: string;
  pendingCreditTotal?: string;
  opsStagingTotal?: string;
  unsupportedSourceTotal?: string;
}

const ESTIMATED_GATEWAY_SEND_FEE_MICRO = 1_000n; // 0.001000 USDC

function parseMicro(value: string | undefined | null): bigint {
  try {
    return decimalUsdcToMicro(value || '0');
  } catch {
    return 0n;
  }
}

function trimUsdcDecimal(value: string): string {
  return value.replace(/\.?0+$/, '');
}

function money(value: string | undefined | null): string {
  const amount = Number(value || '0');
  return amount.toLocaleString('en-US', {
    minimumFractionDigits: amount === 0 ? 2 : 2,
    maximumFractionDigits: 6,
  });
}

export function SendDialog() {
  const [send, setSend] = useQueryState('send');
  const [token, setToken] = useQueryState('token', { defaultValue: 'USDC' });
  const [to, setTo] = useQueryState('to', { defaultValue: '' });
  const [amount, setAmount] = useQueryState('amount', { defaultValue: '1' });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState<GatewayBalanceSnapshot | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    txHash: string | null;
    explorerUrl: string | null;
    transferLogId: string | null;
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
  const amountMicro = parseMicro(amt);
  const spendableMicro = parseMicro(balance?.spendableAvailable ?? balance?.available);
  const maxSendMicro =
    spendableMicro > ESTIMATED_GATEWAY_SEND_FEE_MICRO
      ? spendableMicro - ESTIMATED_GATEWAY_SEND_FEE_MICRO
      : 0n;
  const overSpendable = tok === 'USDC' && balance && amountMicro > maxSendMicro;
  const validTo = /^0x[a-fA-F0-9]{40}$/.test(toAddr);
  const validAmt = Number.isFinite(amtNum) && amtNum > 0 && amtNum <= 10_000 && !overSpendable;
  const valid = validTo && validAmt;

  useEffect(() => {
    if (!open || tok !== 'USDC') return;
    let cancelled = false;
    setBalanceError(null);
    fetch('/api/gateway/balance', { cache: 'no-store' })
      .then(async res => {
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.message || data?.error || `balance_failed (${res.status})`);
        }
        return data as GatewayBalanceSnapshot;
      })
      .then(data => {
        if (!cancelled) setBalance(data);
      })
      .catch(err => {
        if (!cancelled) setBalanceError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [open, tok]);

  const useMax = () => {
    if (tok !== 'USDC' || maxSendMicro <= 0n) return;
    setAmount(trimUsdcDecimal(microUsdcToDecimal(maxSendMicro)));
  };

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
        transferLogId: data.transferLogId ?? null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogShell open={open} title="Send" subtitle="Unified Balance" onClose={close}>
      <p className="dlg-sub">
        {tok === 'USDC'
          ? 'Send from your unified USDC balance. AppKit can source USDC across supported Gateway chains and mint it to the recipient on Arc Testnet.'
          : 'Send EURC from the current Arc wallet balance. EURC is not pooled into Gateway yet.'}
      </p>

      {tok === 'USDC' ? (
        <div className="snd-balance-panel">
          <div className="snd-balance-head">
            <span>Unified Balance</span>
            <strong>
              {balance ? `$${money(balance.spendableTotal ?? balance.grandTotal)}` : '—'}
            </strong>
          </div>
          <div className="snd-balance-grid">
            <span>Current tracked</span>
            <strong>${money(balance?.grandTotal ?? balance?.available)}</strong>
            <span>Estimated fee</span>
            <strong>
              ${trimUsdcDecimal(microUsdcToDecimal(ESTIMATED_GATEWAY_SEND_FEE_MICRO))}
            </strong>
            <span>Max transferable</span>
            <strong>${trimUsdcDecimal(microUsdcToDecimal(maxSendMicro))}</strong>
          </div>
          {(parseMicro(balance?.pendingCreditTotal) > 0n ||
            parseMicro(balance?.opsStagingTotal) > 0n ||
            parseMicro(balance?.unsupportedSourceTotal) > 0n) && (
            <div className="snd-balance-grid snd-balance-muted">
              <span>Finalizing</span>
              <strong>${money(balance?.pendingCreditTotal)}</strong>
              <span>Ops staging</span>
              <strong>${money(balance?.opsStagingTotal)}</strong>
              <span>Not spendable yet</span>
              <strong>${money(balance?.unsupportedSourceTotal)}</strong>
            </div>
          )}
          {balanceError && <div className="snd-balance-error">{balanceError}</div>}
        </div>
      ) : (
        <div className="snd-balance-panel">
          <div className="snd-balance-head">
            <span>Arc wallet balance</span>
            <strong>EURC</strong>
          </div>
          <div className="snd-balance-note">
            EURC sends directly from the Arc wallet service. Unified Gateway pooling is USDC-only.
          </div>
        </div>
      )}

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
              <TokenIcon token={t} size={13} />
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
        <div className="snd-label-row">
          <span className="dlg-label">Amount</span>
          {tok === 'USDC' && (
            <button
              type="button"
              className="snd-max"
              onClick={useMax}
              disabled={!balance || maxSendMicro <= 0n}
            >
              Max
            </button>
          )}
        </div>
        <div className="snd-amount-wrap">
          <input
            className="dlg-input"
            style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}
            inputMode="decimal"
            value={amt}
            onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
            placeholder="0.00"
          />
          <span>{tok}</span>
        </div>
      </div>

      {overSpendable && (
        <div className="dlg-err">
          Amount exceeds the estimated spendable Gateway balance after fees.
        </div>
      )}
      {error && <div className="dlg-err">{error}</div>}
      {result && (
        <div className="dlg-ok">
          <strong>Sent.</strong>{' '}
          {result.txHash && result.explorerUrl && (
            <a className="dlg-link" href={result.explorerUrl} rel="noreferrer" target="_blank">
              {result.txHash.slice(0, 10)}…{result.txHash.slice(-6)} ↗
            </a>
          )}
          {result.transferLogId && (
            <span className="snd-audit">audit {result.transferLogId.slice(0, 8)}</span>
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

      <style jsx>{`
        .snd-balance-panel {
          border: 1px solid var(--border);
          background: color-mix(in oklab, var(--bg-elev) 100%, transparent);
          padding: 10px 12px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .snd-balance-head {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 12px;
          color: var(--text);
        }
        .snd-balance-head span,
        .snd-label-row {
          font-family: var(--font-mono);
          font-size: 10px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--text-faint);
        }
        .snd-balance-head strong {
          font-family: var(--font-mono);
          font-size: 20px;
          font-weight: 500;
          color: var(--text);
        }
        .snd-balance-grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 5px 12px;
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--text-dim);
        }
        .snd-balance-grid strong {
          color: var(--text);
          font-weight: 500;
          text-align: right;
        }
        .snd-balance-muted {
          border-top: 1px solid var(--border);
          padding-top: 8px;
        }
        .snd-balance-note,
        .snd-balance-error {
          font-family: var(--font-mono);
          font-size: 10px;
          line-height: 1.45;
          color: var(--text-faint);
        }
        .snd-balance-error {
          color: var(--danger, #ef4444);
        }
        .snd-label-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .snd-max {
          border: 1px solid var(--border);
          background: var(--bg);
          color: var(--ink);
          font-family: var(--font-mono);
          font-size: 9px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          padding: 3px 8px;
          cursor: pointer;
        }
        .snd-max:disabled {
          cursor: not-allowed;
          opacity: 0.45;
        }
        .snd-amount-wrap {
          position: relative;
        }
        .snd-amount-wrap input {
          padding-right: 58px;
        }
        .snd-amount-wrap span {
          position: absolute;
          right: 12px;
          top: 50%;
          transform: translateY(-50%);
          font-family: var(--font-mono);
          font-size: 10px;
          letter-spacing: 0.1em;
          color: var(--text-faint);
          pointer-events: none;
        }
        .snd-audit {
          margin-left: 8px;
          font-family: var(--font-mono);
          font-size: 10px;
          letter-spacing: 0.08em;
          color: var(--text-faint);
          text-transform: uppercase;
        }
      `}</style>
    </DialogShell>
  );
}
