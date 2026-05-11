'use client';

/**
 * SendDialog — USDC transfer from the unified Gateway balance.
 * State lives in `?send=open&to=…&amount=1.00&toChain=Arc_Testnet`.
 *
 * Sendero is USDC-only — the unified Gateway pool is the single
 * source of funds. App Kit auto-allocates across every Gateway-enabled
 * chain (Arc, Sol, EVM bridge chains) to satisfy the spend.
 *
 * Destination chain is user-selectable (same selector as BridgeDialog).
 * Recipient validation switches between EVM hex (0x…40) and Sol base58.
 */

import { useEffect, useState } from 'react';

import { BlockchainIcon } from '@sendero/icons';
import { useQueryState } from 'nuqs';

import { decimalUsdcToMicro, microUsdcToDecimal } from '@/lib/gateway-balance-math';
import { useSendero } from '@/components/store';

import { DialogShell } from './dialog-shell';

interface GatewayBalanceSnapshot {
  grandTotal?: string;
  available?: string;
  spendableAvailable?: string;
  pendingCreditTotal?: string;
  opsStagingTotal?: string;
  unsupportedSourceTotal?: string;
}

const ESTIMATED_GATEWAY_SEND_FEE_MICRO = 1_000n; // 0.001000 USDC

const DESTINATION_CHAINS = [
  { id: 'Arc_Testnet', label: 'Arc Testnet', family: 'evm' as const },
  { id: 'Sol_Devnet', label: 'Solana Devnet', family: 'sol' as const },
  { id: 'Ethereum_Sepolia', label: 'Ethereum Sepolia', family: 'evm' as const },
  { id: 'Base_Sepolia', label: 'Base Sepolia', family: 'evm' as const },
  { id: 'Avalanche_Fuji', label: 'Avalanche Fuji', family: 'evm' as const },
  { id: 'Arbitrum_Sepolia', label: 'Arbitrum Sepolia', family: 'evm' as const },
  { id: 'Optimism_Sepolia', label: 'Optimism Sepolia', family: 'evm' as const },
  { id: 'Polygon_Amoy_Testnet', label: 'Polygon Amoy', family: 'evm' as const },
] as const;

type DestinationChainId = (typeof DESTINATION_CHAINS)[number]['id'];
type ChainFamily = 'evm' | 'sol';

function chainFamily(id: DestinationChainId): ChainFamily {
  return DESTINATION_CHAINS.find(c => c.id === id)?.family ?? 'evm';
}

function chainLabel(id: DestinationChainId): string {
  return DESTINATION_CHAINS.find(c => c.id === id)?.label ?? id;
}

const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
// Sol base58 (Bitcoin alphabet) — 32-byte pubkey encodes to 32–44 chars
const SOL_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function isValidRecipient(addr: string, family: ChainFamily): boolean {
  if (family === 'sol') return SOL_ADDRESS_RE.test(addr);
  return EVM_ADDRESS_RE.test(addr);
}

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

export function SendDialog() {
  const tenantChain = useSendero(s => s.userAuth?.chain);
  const defaultChain: DestinationChainId =
    tenantChain === 'sol' ? 'Sol_Devnet' : 'Arc_Testnet';

  const [send, setSend] = useQueryState('send');
  const [to, setTo] = useQueryState('sendTo', { defaultValue: '' });
  const [amount, setAmount] = useQueryState('sendAmount', { defaultValue: '1' });
  const [toChain, setToChain] = useQueryState('sendToChain', {
    defaultValue: defaultChain,
  });

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

  const dest = (toChain as DestinationChainId) || 'Arc_Testnet';
  const family = chainFamily(dest);
  const toAddr = (to || '').trim();
  const amt = amount || '';
  const amtNum = Number(amt);
  const amountMicro = parseMicro(amt);
  const spendableMicro = parseMicro(balance?.spendableAvailable ?? balance?.available);
  const maxSendMicro =
    spendableMicro > ESTIMATED_GATEWAY_SEND_FEE_MICRO
      ? spendableMicro - ESTIMATED_GATEWAY_SEND_FEE_MICRO
      : 0n;
  const overSpendable = balance && amountMicro > maxSendMicro;
  const validTo = isValidRecipient(toAddr, family);
  const validAmt = Number.isFinite(amtNum) && amtNum > 0 && amtNum <= 10_000 && !overSpendable;
  const valid = validTo && validAmt;

  useEffect(() => {
    if (!open) return;
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
  }, [open]);

  const useMax = () => {
    if (maxSendMicro <= 0n) return;
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
        body: JSON.stringify({
          token: 'USDC',
          to: toAddr,
          amount: amt,
          destinationChain: dest,
        }),
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

  const recipientPlaceholder = family === 'sol' ? '7EqQdEUL…wJeK' : '0xabcd…1234';
  const recipientHint = family === 'sol' ? 'Recipient (Solana base58)' : 'Recipient (0x…40 hex)';

  return (
    <DialogShell open={open} title="Send" subtitle="Unified Balance" onClose={close}>
      <p className="dlg-sub">
        Send USDC from your unified balance. App Kit pulls liquidity from any chain in your
        Gateway pool (Arc, Sol, every EVM bridge chain) and mints on the destination.
      </p>

      {balanceError && <div className="snd-balance-error">{balanceError}</div>}

      <div className="dlg-row">
        <span className="dlg-label">Destination chain</span>
        <div className="snd-select-wrap">
          <BlockchainIcon chain={dest} size={16} />
          <select
            className="dlg-select snd-chain-select"
            value={dest}
            onChange={e => setToChain(e.target.value)}
            aria-label="Destination chain"
          >
            {DESTINATION_CHAINS.map(c => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="dlg-row">
        <span className="dlg-label">{recipientHint}</span>
        <input
          className="dlg-input"
          style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
          value={toAddr}
          onChange={e => setTo(e.target.value)}
          placeholder={recipientPlaceholder}
          spellCheck={false}
        />
      </div>

      <div className="dlg-row">
        <div className="snd-label-row">
          <span className="dlg-label">Amount</span>
          <button
            type="button"
            className="snd-max"
            onClick={useMax}
            disabled={!balance || maxSendMicro <= 0n}
          >
            Max
          </button>
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
          <span>USDC</span>
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
              Send {amt || '0'} USDC →{' '}
              {validTo
                ? `${toAddr.slice(0, 6)}…${toAddr.slice(-4)} on ${chainLabel(dest)}`
                : chainLabel(dest)}
            </span>
          </>
        )}
      </button>

      <style jsx>{`
        .snd-select-wrap {
          position: relative;
          width: 100%;
        }
        .snd-select-wrap > :global(svg) {
          position: absolute;
          left: 12px;
          top: 50%;
          transform: translateY(-50%);
          pointer-events: none;
          z-index: 1;
        }
        .snd-chain-select {
          padding-left: 36px;
          appearance: none;
          -webkit-appearance: none;
          background-image: linear-gradient(45deg, transparent 50%, var(--text-dim) 50%),
            linear-gradient(135deg, var(--text-dim) 50%, transparent 50%);
          background-position:
            calc(100% - 18px) 50%,
            calc(100% - 13px) 50%;
          background-size:
            5px 5px,
            5px 5px;
          background-repeat: no-repeat;
          padding-right: 32px;
        }
        .snd-balance-error {
          font-family: var(--font-mono);
          font-size: 10px;
          line-height: 1.45;
          color: var(--danger, #ef4444);
        }
        .snd-label-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-family: var(--font-mono);
          font-size: 10px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--text-faint);
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
