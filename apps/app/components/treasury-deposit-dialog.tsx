'use client';

/**
 * TreasuryDepositDialog — chain-aware single-address deposit instructions.
 *
 * Distinct from `DepositDialog` (Gateway-multichain): the Treasury is a
 * single wallet on the tenant's primaryChain — Arc MSCA (`0x…`) or
 * Squads V4 vault (base58). The expected use is operator-funded top-up
 * or settled-margin sweep destination — funds that should NOT pool into
 * the Gateway hot path.
 *
 * Reads the active address from `useSendero().userAuth` (set by
 * ClerkWalletBridge). USDC and EURC both deposit to the same address;
 * the token tab is informational (different mint/contract per chain).
 *
 * No multi-chain listing on purpose — if you want unified balance,
 * use Operations.
 */

import { useEffect, useState } from 'react';

import { useQueryState } from 'nuqs';
import { BlockchainIcon, TokenIcon } from '@sendero/icons';

import { DialogShell } from './dialog-shell';
import { useSendero } from './store';

type Token = 'USDC' | 'EURC';

export function TreasuryDepositDialog() {
  const [deposit, setDeposit] = useQueryState('treasury-deposit');
  const userAuth = useSendero(s => s.userAuth);
  const [selectedToken, setSelectedToken] = useState<Token>('USDC');
  const [copied, setCopied] = useState(false);

  const open = deposit === 'open';
  const chain: 'arc' | 'sol' = userAuth?.chain === 'sol' ? 'sol' : 'arc';
  const address = userAuth?.address ?? '';
  // Pending placeholder addresses set by ClerkWalletBridge — show a
  // helpful state rather than an unusable copy button.
  const isPending =
    !address ||
    (chain === 'sol' && (address === 'pending-sol' || address.length < 32)) ||
    (chain === 'arc' && /^0x0+$/i.test(address));

  const close = () => {
    setDeposit(null);
    setCopied(false);
  };

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(id);
  }, [copied]);

  const copy = async () => {
    if (isPending) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
    } catch {
      /* silent */
    }
  };

  const chainLabel = chain === 'sol' ? 'Solana Devnet' : 'Arc Testnet';
  const chainKind = chain === 'sol' ? 'solana' : 'evm';
  const blockchainKey = chain === 'sol' ? 'Sol_Devnet' : 'Arc_Testnet';

  return (
    <DialogShell
      open={open}
      title="Deposit · Treasury"
      subtitle={chain === 'sol' ? 'Solana · Squads V4' : 'Arc · MSCA'}
      onClose={close}
    >
      <div className="td-wrap">
        <p className="td-lede">
          Send {selectedToken} on <strong>{chainLabel}</strong> to your Treasury wallet. Funds land
          in the cold vault and won&apos;t auto-route into the Gateway unified balance. Use
          Operations for live booking flow.
        </p>

        <div className="td-tabs" role="tablist">
          {(['USDC', 'EURC'] as Token[]).map(t => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={selectedToken === t}
              className={`td-tab ${selectedToken === t ? 'sel' : ''}`}
              onClick={() => setSelectedToken(t)}
            >
              <span className="td-tab-dot">
                <TokenIcon token={t} size={14} />
              </span>
              {t}
            </button>
          ))}
        </div>

        <div className="td-card">
          <div className="td-row">
            <span className="td-row-label">Chain</span>
            <span className="td-row-value">
              <BlockchainIcon chain={blockchainKey} size={14} />
              {chainLabel}
            </span>
          </div>
          <div className="td-row">
            <span className="td-row-label">Address</span>
            {isPending ? (
              <span className="td-row-value td-pending">
                Provisioning… check back in a few seconds
              </span>
            ) : (
              <span className="td-row-value td-mono" title={address}>
                {address}
              </span>
            )}
          </div>
          <div className="td-row td-row--actions">
            <button
              type="button"
              className={`td-copy ${copied ? 'copied' : ''}`}
              disabled={isPending}
              onClick={copy}
            >
              {copied ? 'Copied' : 'Copy address'}
            </button>
          </div>
        </div>

        <p className="td-warn">
          ⚠ {chainKind === 'solana'
            ? `Send only USDC/EURC on Solana Devnet. The Squads V4 vault doesn't sweep cross-chain — deposits on any other chain are unrecoverable.`
            : `Send only USDC/EURC on Arc Testnet. The MSCA owns this address on Arc only — deposits on EVM siblings (Avalanche / Arbitrum / Polygon) won't appear here.`}
        </p>
      </div>

      <style jsx>{`
        .td-wrap {
          display: grid;
          gap: 18px;
        }
        .td-lede {
          margin: 0;
          font-size: 13px;
          line-height: 1.55;
          color: var(--text-dim, #4b5160);
        }
        .td-tabs {
          display: grid;
          grid-template-columns: 1fr 1fr;
          border: 1px solid var(--border, #d8c1a7);
          border-radius: 999px;
          padding: 4px;
          gap: 4px;
          background: color-mix(in oklab, var(--bg-elev, #fdfbf7) 70%, transparent);
        }
        .td-tab {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 8px 12px;
          border: 0;
          border-radius: 999px;
          background: transparent;
          cursor: pointer;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 11px;
          letter-spacing: 0.12em;
          color: var(--text-dim, #4b5160);
          transition: background 120ms;
        }
        .td-tab.sel {
          background: var(--ink, #fb542b);
          color: #fff;
        }
        .td-tab-dot {
          display: inline-grid;
          place-items: center;
          width: 16px;
          height: 16px;
        }
        .td-card {
          display: grid;
          gap: 10px;
          padding: 16px;
          border: 1px solid var(--border, #d8c1a7);
          border-radius: 12px;
          background: color-mix(in oklab, var(--ink, #fb542b) 4%, transparent);
        }
        .td-row {
          display: grid;
          grid-template-columns: 80px 1fr;
          gap: 12px;
          align-items: center;
        }
        .td-row--actions {
          grid-template-columns: 1fr;
          justify-items: end;
        }
        .td-row-label {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 10px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--text-faint, #8a8f99);
        }
        .td-row-value {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
          color: var(--text, #1f2a44);
          word-break: break-all;
        }
        .td-mono {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 12px;
        }
        .td-pending {
          color: var(--text-dim, #4b5160);
          font-style: italic;
        }
        .td-copy {
          padding: 8px 14px;
          border: 1px solid var(--ink, #fb542b);
          border-radius: 8px;
          background: transparent;
          color: var(--ink, #fb542b);
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 11px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          cursor: pointer;
          transition: background 120ms;
        }
        .td-copy:hover:not(:disabled) {
          background: color-mix(in oklab, var(--ink, #fb542b) 8%, transparent);
        }
        .td-copy.copied {
          background: var(--ink, #fb542b);
          color: #fff;
        }
        .td-copy:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .td-warn {
          margin: 0;
          padding: 12px 14px;
          font-size: 11.5px;
          line-height: 1.5;
          color: color-mix(in oklab, var(--midnight, #1f2a44) 80%, transparent);
          background: color-mix(in oklab, var(--accent-amber, #c08a3a) 6%, transparent);
          border-left: 3px solid color-mix(in oklab, var(--accent-amber, #c08a3a) 60%, transparent);
          border-radius: 4px;
        }
      `}</style>
    </DialogShell>
  );
}
