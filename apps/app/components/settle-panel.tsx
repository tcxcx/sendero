'use client';

/**
 * SettlePanel — one-tap user-signed settlement on Arc.
 *
 * Single userOperation batches:
 *   1. USDC.transfer(provider, amount)    — pay the agent
 *   2. Reputation.giveFeedback(agentId)   — log on-chain reputation
 *
 * One biometric → both calls land atomically in the same Arc block, gas
 * sponsored by Circle Gas Station.
 *
 * (The full ERC-8183 job state machine requires interleaved client/provider
 * txs across 3 userOps; we collapse to this direct-pay + attest shape so
 * the user signs once and the money actually moves.)
 */

import { useState } from 'react';

import { useSendero } from './store';
import { restoreFromStorage, sendUserOp } from '@sendero/circle/modular-wallets';
import { encodeGiveFeedback, encodeUsdcTransfer, toUsdcUnits } from '@sendero/erc8183/client';

const ARC_EXPLORER_BASE = 'https://testnet.arcscan.app';
const SOL_EXPLORER_BASE = 'https://explorer.solana.com';
const SOL_DEVNET_QS = '?cluster=devnet';
const SETTLE_LOG_GROUP = 'settle.arc';

function explorerForChain(chain: 'arc' | 'sol' | undefined): {
  base: string;
  txQs: string;
  name: string;
} {
  if (chain === 'sol') {
    return { base: SOL_EXPLORER_BASE, txQs: SOL_DEVNET_QS, name: 'Solana Explorer' };
  }
  return { base: ARC_EXPLORER_BASE, txQs: '', name: 'Arcscan' };
}

interface AgentIdentityResponse {
  agentId: string;
  providerAddress: string;
}

function now(): string {
  const d = new Date();
  return d.toLocaleTimeString('en-US', { hour12: false });
}

async function fetchAgentIdentity(): Promise<AgentIdentityResponse> {
  const res = await fetch('/api/agent/identity', { cache: 'no-store' });
  const json = (await res.json()) as Partial<AgentIdentityResponse> & {
    error?: string;
    message?: string;
  };
  if (!res.ok || !json.agentId || !json.providerAddress) {
    throw new Error(json.message || json.error || `agent identity fetch failed (${res.status})`);
  }
  return { agentId: json.agentId, providerAddress: json.providerAddress };
}

export function SettlePanel() {
  const holdOrder = useSendero(s => s.holdOrder);
  const onChainSettlement = useSendero(s => s.onChainSettlement);
  const settlement = useSendero(s => s.settlement);
  const userAuth = useSendero(s => s.userAuth);

  const setSettlementPhase = useSendero(s => s.setSettlementPhase);
  const pushSettlementTx = useSendero(s => s.pushSettlementTx);
  const setSettlementError = useSendero(s => s.setSettlementError);
  const setLastUserOpHash = useSendero(s => s.setLastUserOpHash);
  const resetSettlement = useSendero(s => s.resetSettlement);
  const setOnChainSettlement = useSendero(s => s.setOnChainSettlement);
  const logEvent = useSendero(s => s.logEvent);

  const [busy, setBusy] = useState(false);

  // Self-gates
  if (!holdOrder || onChainSettlement) return null;

  if (!userAuth) {
    return (
      <div className="card" style={{ opacity: 0.7 }}>
        <div className="card-head">
          <span className="title">Confirm payment</span>
          <span className="tag faint">Sign in required</span>
        </div>
        <div
          style={{
            padding: 16,
            fontFamily: 'var(--font-sans)',
            fontSize: 13,
            color: 'var(--text-dim)',
          }}
        >
          Sign in with a passkey to confirm payment for this booking.
        </div>
      </div>
    );
  }

  const phase = settlement.phase;
  const totalAmount = holdOrder.totalAmount;
  const totalCurrency = holdOrder.totalCurrency;

  const explorer = explorerForChain(userAuth?.chain);

  async function settle() {
    if (busy) return;
    setBusy(true);
    setSettlementError(null);
    setSettlementPhase('signing');

    try {
      const [wallet, identity] = await Promise.all([restoreFromStorage(), fetchAgentIdentity()]);
      if (!wallet) {
        throw new Error('Session expired — sign in with your passkey again.');
      }

      logEvent({
        group: SETTLE_LOG_GROUP,
        bullet: 'active',
        text: `pay(<span class="v">${totalAmount} USDC</span>) · attest(<span class="v">#${identity.agentId}</span>)`,
        t: now(),
      });

      const amountUnits = toUsdcUnits(totalAmount);

      const calls = [
        encodeUsdcTransfer(identity.providerAddress as `0x${string}`, amountUnits),
        encodeGiveFeedback({
          agentId: BigInt(identity.agentId),
          score: 95,
          tag: `pnr:${holdOrder!.bookingReference}`,
        }),
      ];

      const { txHash, userOpHash } = await sendUserOp(wallet, calls);
      pushSettlementTx(txHash);
      setLastUserOpHash(userOpHash);

      setOnChainSettlement({
        jobId: '—',
        pnr: holdOrder!.bookingReference,
        deliverableHash: '0x',
        txHashes: [txHash],
        explorerBase: explorer.base,
        completedAt: Date.now(),
        demo: false,
      });
      setSettlementPhase('done');

      logEvent({
        group: SETTLE_LOG_GROUP,
        bullet: 'done',
        text: `settled in <span class="v">1 userOp</span> · <span class="v">${totalAmount} USDC</span> → provider`,
        t: now(),
      });

      // Fire-and-forget reputation cache bust so the AgentCard refreshes.
      fetch('/api/settle/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: identity.agentId }),
      }).catch(() => {});
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSettlementError(msg);
      logEvent({
        group: SETTLE_LOG_GROUP,
        bullet: 'fail',
        text: `error: ${msg.slice(0, 80)}`,
        t: now(),
      });
    } finally {
      setBusy(false);
    }
  }

  let buttonLabel: string;
  let buttonDisabled = busy;
  let buttonAction: (() => void) | null = settle;

  switch (phase) {
    case 'idle':
      buttonLabel = busy ? 'Confirming…' : `Confirm payment · sign once`;
      break;
    case 'signing':
      buttonLabel = 'Confirming · processing…';
      buttonDisabled = true;
      buttonAction = null;
      break;
    case 'done':
      buttonLabel = 'Paid ✓';
      buttonDisabled = true;
      buttonAction = null;
      break;
    case 'error':
      buttonLabel = 'Retry';
      buttonDisabled = false;
      buttonAction = () => {
        resetSettlement();
        settle();
      };
      break;
    default:
      buttonLabel = 'Confirm payment · sign once';
  }

  const signerShort = `${userAuth.address.slice(0, 6)}…${userAuth.address.slice(-4)}`;

  return (
    <div className="card">
      <div className="card-head">
        <span className="title">Confirm payment</span>
        <span className="tag ink">1 passkey tap · no gas fees</span>
      </div>

      <div
        style={{
          padding: '10px 16px',
          borderBottom: '1px solid var(--border)',
          fontFamily: 'var(--font-sans)',
          fontSize: 13,
          color: 'var(--text-dim)',
          lineHeight: 1.5,
        }}
      >
        Pay{' '}
        <strong style={{ color: 'var(--text)' }}>
          {totalAmount} {totalCurrency === 'USD' ? 'USDC' : totalCurrency}
        </strong>{' '}
        to the provider and log a +1 reputation point on the agent's record. One signature settles
        both atomically; gas is on us.
      </div>

      <div className="settle-grid">
        <div className="settle-cell">
          <span className="k">Pay</span>
          <span className="v">
            {Number(totalAmount).toLocaleString('en-US', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
          <span className="k">USDC → provider</span>
        </div>
        <div className="settle-cell">
          <span className="k">Attest</span>
          <span className="v">+1 feedback</span>
          <span className="k">ERC-8004 · score 95</span>
        </div>
        <div className="settle-cell">
          <span className="k">Bundler</span>
          <span className="v">paymaster</span>
          <span className="k">Circle Gas Station</span>
        </div>
        <div className="settle-cell">
          <span className="k">Signer</span>
          <span className="v mono-v">{signerShort}</span>
          <span className="k">your wallet</span>
        </div>
      </div>

      {phase === 'signing' && (
        <div
          style={{
            padding: '10px 16px',
            borderTop: '1px solid var(--border)',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            letterSpacing: '0.04em',
            color: 'var(--ink)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'var(--ink)',
              animation: 'blink 1s infinite',
              flexShrink: 0,
            }}
          />
          Waiting for passkey → bundler → Arc confirmation…
        </div>
      )}

      {phase === 'error' && settlement.error && (
        <div
          style={{
            padding: '10px 16px',
            borderTop: '1px solid var(--border)',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--accent-rose)',
            lineHeight: 1.5,
            maxHeight: 110,
            overflow: 'auto',
          }}
        >
          {settlement.error}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          gap: 8,
          padding: 14,
          borderTop: '1px solid var(--border)',
          justifyContent: 'flex-end',
        }}
      >
        <button
          type="button"
          className="btn primary"
          disabled={buttonDisabled || !buttonAction}
          onClick={() => buttonAction?.()}
        >
          {buttonLabel}
        </button>
      </div>

      {settlement.txHashes.length > 0 && (
        <div
          style={{
            padding: '12px 16px',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              letterSpacing: '0.08em',
              color: 'var(--text-dim)',
              textTransform: 'uppercase',
              marginBottom: 4,
            }}
          >
            On-chain
          </div>
          {settlement.txHashes.map(hash => (
            <a
              key={hash}
              href={`${explorer.base}/tx/${hash}${explorer.txQs}`}
              target="_blank"
              rel="noreferrer"
              style={{
                display: 'grid',
                gridTemplateColumns: '20px 1fr auto auto',
                gap: 10,
                alignItems: 'center',
                padding: '6px 10px',
                border: '1px solid var(--border)',
                background: 'var(--bg-elev)',
                textDecoration: 'none',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: 'var(--text)',
              }}
            >
              <span style={{ color: 'var(--accent-green)' }}>●</span>
              <span style={{ color: 'var(--text-dim)' }}>pay + attest</span>
              <span style={{ color: 'var(--ink)' }}>
                {hash.slice(0, 10)}…{hash.slice(-4)}
              </span>
              <span style={{ color: 'var(--text-faint)', fontSize: 10 }}>↗</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
