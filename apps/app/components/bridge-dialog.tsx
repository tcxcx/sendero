'use client';

/**
 * BridgeDialog — move USDC between chains inside the unified Gateway
 * balance.
 *
 * The user picks WHERE funds should land. App Kit auto-allocates
 * the source from across the tenant's pool (Arc + Sol + every
 * Gateway-enabled EVM bridge chain) — the sweep already pushed
 * incoming deposits into that pool, so source-side liquidity is
 * implicit. State lives in `?bridge=open&toChain=Arc_Testnet&amount=1.00`.
 */

import { useState } from 'react';

import { BlockchainIcon, TokenIcon } from '@sendero/icons';
import { useQueryState } from 'nuqs';

import { useSendero } from '@/components/store';

import { DialogShell } from './dialog-shell';

const DESTINATION_CHAINS = [
  { id: 'Arc_Testnet', label: 'Arc Testnet' },
  { id: 'Sol_Devnet', label: 'Solana Devnet' },
  { id: 'Ethereum_Sepolia', label: 'Ethereum Sepolia' },
  { id: 'Base_Sepolia', label: 'Base Sepolia' },
  { id: 'Avalanche_Fuji', label: 'Avalanche Fuji' },
  { id: 'Arbitrum_Sepolia', label: 'Arbitrum Sepolia' },
  { id: 'Optimism_Sepolia', label: 'Optimism Sepolia' },
  { id: 'Polygon_Amoy_Testnet', label: 'Polygon Amoy' },
] as const;

type DestinationChainId = (typeof DESTINATION_CHAINS)[number]['id'];

function chainLabel(id: DestinationChainId): string {
  return DESTINATION_CHAINS.find(c => c.id === id)?.label ?? id;
}

export function BridgeDialog() {
  const tenantChain = useSendero(s => s.userAuth?.chain);
  const defaultChain: DestinationChainId =
    tenantChain === 'sol' ? 'Sol_Devnet' : 'Arc_Testnet';

  const [bridge, setBridge] = useQueryState('bridge');
  const [toChain, setToChain] = useQueryState('bridgeToChain', {
    defaultValue: defaultChain,
  });
  const [amount, setAmount] = useQueryState('bridgeAmount', { defaultValue: '1' });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<
    Array<{ name: string; state: string; txHash?: string; explorerUrl?: string }>
  >([]);

  const open = bridge === 'open';
  const close = () => {
    setBridge(null);
    setError(null);
    setSteps([]);
    setBusy(false);
  };

  const dest = (toChain as DestinationChainId) || 'Arc_Testnet';
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
        body: JSON.stringify({ destinationChain: dest, amount: amt }),
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
      title="Bridge"
      subtitle="Move funds between chains in your unified balance"
      onClose={close}
    >
      <p className="dlg-sub">
        Pick where you want USDC to land. App Kit pulls liquidity from any chain in your unified
        balance and mints on the destination. No source picker — the sweep keeps the pool
        topped up.
      </p>

      <div className="dlg-row">
        <span className="dlg-label">Destination chain</span>
        <div className="br-select-wrap">
          <BlockchainIcon chain={dest} size={16} />
          <select
            className="dlg-select br-chain-select"
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
            <span>Bridging…</span>
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
              Bridge {amt || '0'} USDC → {chainLabel(dest)}
            </span>
          </>
        )}
      </button>

      <style jsx>{`
        .br-select-wrap {
          position: relative;
          width: 100%;
        }
        .br-select-wrap > :global(svg) {
          position: absolute;
          left: 12px;
          top: 50%;
          transform: translateY(-50%);
          pointer-events: none;
          z-index: 1;
        }
        .br-chain-select {
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
      `}</style>
    </DialogShell>
  );
}
