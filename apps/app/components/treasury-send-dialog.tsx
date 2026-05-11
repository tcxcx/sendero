'use client';

/**
 * TreasurySendDialog — chain-aware multisig-gated send from the Treasury.
 *
 * Treasury sends are NOT autonomous like Operations (Gateway). They
 * require multisig approval before execution:
 *
 *   - Arc → Circle MSCA UserOp; signers configured in
 *     `@sendero/multisig/weight-config`. Sub-threshold weight queues
 *     the UserOp pending co-sign.
 *   - Sol → Squads V4 proposal via `@sendero/multisig` /
 *     `@sqds/multisig`. Proposers can create; approvers must sign
 *     before executor lands the tx.
 *
 * This dialog collects (chain, destination, amount) and POSTS to
 * `/api/treasury/send`. The route is the same per-chain dispatcher
 * used by the admin app (`apps/admin/lib/treasury/propose-solana.ts`
 * for Sol; the userop-builder helpers for Arc).
 *
 * Hackathon scope: the POST records intent and returns a proposal id
 * that surfaces here. Full execution wiring (signature collection +
 * submit) lands post-deadline.
 */

import { useEffect, useMemo, useState } from 'react';

import { useQueryState } from 'nuqs';

import { DialogShell } from './dialog-shell';
import { useSendero } from './store';

type SendStatus = 'idle' | 'submitting' | 'queued' | 'failed';

export function TreasurySendDialog() {
  const [send, setSend] = useQueryState('treasury-send');
  const userAuth = useSendero(s => s.userAuth);

  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [status, setStatus] = useState<SendStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [proposalId, setProposalId] = useState<string | null>(null);

  const open = send === 'open';
  const chain: 'arc' | 'sol' = userAuth?.chain === 'sol' ? 'sol' : 'arc';
  const chainLabel = chain === 'sol' ? 'Solana · Squads V4' : 'Arc · MSCA';

  // Reset form whenever the dialog opens fresh.
  useEffect(() => {
    if (!open) return;
    setStatus('idle');
    setError(null);
    setProposalId(null);
  }, [open]);

  const close = () => {
    setSend(null);
    setRecipient('');
    setAmount('');
    setMemo('');
    setStatus('idle');
    setError(null);
    setProposalId(null);
  };

  // Basic validation — chain-aware. Arc expects `0x…` 42 chars; Sol
  // expects base58 32–44 chars.
  const recipientValid = useMemo(() => {
    const r = recipient.trim();
    if (!r) return false;
    if (chain === 'arc') return /^0x[0-9a-fA-F]{40}$/.test(r);
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(r);
  }, [recipient, chain]);
  const amountValid = useMemo(() => {
    const n = Number(amount);
    return Number.isFinite(n) && n > 0;
  }, [amount]);
  const canSubmit = recipientValid && amountValid && status !== 'submitting';

  const submit = async () => {
    if (!canSubmit) return;
    setStatus('submitting');
    setError(null);
    try {
      const res = await fetch('/api/treasury/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chain,
          token: 'USDC',
          recipient: recipient.trim(),
          amount,
          memo: memo.trim() || undefined,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        proposalId?: string;
        error?: string;
        message?: string;
      };
      if (!res.ok || !body.ok) {
        setStatus('failed');
        setError(body.message ?? body.error ?? `Request failed (${res.status})`);
        return;
      }
      setProposalId(body.proposalId ?? 'queued');
      setStatus('queued');
    } catch (e) {
      setStatus('failed');
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <DialogShell
      open={open}
      title="Send · Treasury"
      subtitle={chainLabel}
      onClose={close}
    >
      <div className="ts-wrap">
        <p className="ts-lede">
          Treasury sends are queued as a {chain === 'sol' ? 'Squads V4 proposal' : 'MSCA UserOp'}{' '}
          and require multisig approval before execution. Not autonomous like Operations.
        </p>

        {status === 'queued' ? (
          <div className="ts-success" role="status">
            <span className="ts-success-tag">Queued for approval</span>
            <p>
              {chain === 'sol' ? 'Squads V4 proposal' : 'MSCA UserOp'} created. Approvers will be
              notified; the transfer lands after threshold weight signs off.
            </p>
            {proposalId ? <code className="ts-proposal-id">{proposalId}</code> : null}
            <button type="button" className="ts-close" onClick={close}>
              Close
            </button>
          </div>
        ) : (
          <>
            <label className="ts-field">
              <span className="ts-field-label">Recipient</span>
              <input
                type="text"
                placeholder={
                  chain === 'sol'
                    ? 'base58 Solana address (32–44 chars)'
                    : '0x… EVM address (42 chars)'
                }
                value={recipient}
                onChange={e => setRecipient(e.target.value)}
                className="ts-input ts-mono"
                spellCheck={false}
                autoComplete="off"
              />
              {recipient && !recipientValid ? (
                <span className="ts-field-err">
                  Doesn&apos;t look like a {chain === 'sol' ? 'Solana' : 'EVM'} address.
                </span>
              ) : null}
            </label>

            <label className="ts-field">
              <span className="ts-field-label">Amount (USDC)</span>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                className="ts-input"
              />
            </label>

            <label className="ts-field">
              <span className="ts-field-label">Memo (optional)</span>
              <input
                type="text"
                placeholder="What's this for? Surfaces in the approval thread."
                value={memo}
                onChange={e => setMemo(e.target.value)}
                className="ts-input"
                maxLength={140}
              />
            </label>

            {error ? <p className="ts-err">{error}</p> : null}

            <div className="ts-actions">
              <button type="button" className="ts-cancel" onClick={close}>
                Cancel
              </button>
              <button
                type="button"
                className="ts-submit"
                disabled={!canSubmit}
                onClick={submit}
              >
                {status === 'submitting'
                  ? 'Submitting…'
                  : chain === 'sol'
                    ? 'Create Squads proposal'
                    : 'Queue MSCA UserOp'}
              </button>
            </div>
          </>
        )}
      </div>

      <style jsx>{`
        .ts-wrap {
          display: grid;
          gap: 16px;
        }
        .ts-lede {
          margin: 0;
          font-size: 13px;
          line-height: 1.55;
          color: var(--text-dim, #4b5160);
        }
        .ts-field {
          display: grid;
          gap: 6px;
        }
        .ts-field-label {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 10px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--text-faint, #8a8f99);
        }
        .ts-field-err {
          font-size: 11.5px;
          color: var(--accent-rose, #b54848);
        }
        .ts-input {
          width: 100%;
          padding: 10px 12px;
          border: 1px solid var(--border, #d8c1a7);
          border-radius: 8px;
          background: var(--bg-elev, #fdfbf7);
          color: var(--text, #1f2a44);
          font-size: 13px;
          transition: border-color 120ms;
        }
        .ts-input:focus {
          outline: none;
          border-color: var(--ink, #fb542b);
        }
        .ts-mono {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 12px;
        }
        .ts-err {
          margin: 0;
          padding: 10px 12px;
          font-size: 11.5px;
          color: var(--accent-rose, #b54848);
          background: color-mix(in oklab, var(--accent-rose, #b54848) 6%, transparent);
          border-radius: 4px;
        }
        .ts-actions {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          padding-top: 4px;
        }
        .ts-cancel,
        .ts-submit {
          padding: 9px 16px;
          border-radius: 8px;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 11px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          cursor: pointer;
          transition:
            background 120ms,
            opacity 120ms;
        }
        .ts-cancel {
          border: 1px solid var(--border, #d8c1a7);
          background: transparent;
          color: var(--text, #1f2a44);
        }
        .ts-submit {
          border: 1px solid var(--ink, #fb542b);
          background: var(--ink, #fb542b);
          color: #fff;
        }
        .ts-submit:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .ts-success {
          display: grid;
          gap: 12px;
          padding: 18px;
          border: 1px solid color-mix(in oklab, var(--ink, #fb542b) 32%, transparent);
          border-radius: 12px;
          background: color-mix(in oklab, var(--ink, #fb542b) 8%, transparent);
        }
        .ts-success-tag {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 10px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: var(--ink, #fb542b);
        }
        .ts-success p {
          margin: 0;
          font-size: 13px;
          line-height: 1.55;
          color: var(--text, #1f2a44);
        }
        .ts-proposal-id {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 11px;
          padding: 6px 10px;
          background: var(--bg-elev, #fdfbf7);
          border-radius: 4px;
          color: var(--text-dim, #4b5160);
          word-break: break-all;
        }
        .ts-close {
          align-self: end;
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
        }
      `}</style>
    </DialogShell>
  );
}
