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

import { useEffect, useState } from 'react';

import { useSendero } from './store';
import { restoreFromStorage, sendUserOp } from '@/lib/user-wallet';
import {
  encodeGiveFeedback,
  encodeUsdcTransfer,
  toUsdcUnits,
} from '@/lib/erc8183-client';

const EXPLORER_BASE = 'https://testnet.arcscan.app';
const SETTLE_LOG_GROUP = 'settle.arc';

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
    throw new Error(
      json.message || json.error || `agent identity fetch failed (${res.status})`,
    );
  }
  return { agentId: json.agentId, providerAddress: json.providerAddress };
}

export function SettlePanel() {
  const holdOrder = useSendero((s) => s.holdOrder);
  const onChainSettlement = useSendero((s) => s.onChainSettlement);
  const settlement = useSendero((s) => s.settlement);
  const userAuth = useSendero((s) => s.userAuth);

  const setSettlementPhase = useSendero((s) => s.setSettlementPhase);
  const pushSettlementTx = useSendero((s) => s.pushSettlementTx);
  const setSettlementError = useSendero((s) => s.setSettlementError);
  const setLastUserOpHash = useSendero((s) => s.setLastUserOpHash);
  const resetSettlement = useSendero((s) => s.resetSettlement);
  const setOnChainSettlement = useSendero((s) => s.setOnChainSettlement);
  const logEvent = useSendero((s) => s.logEvent);

  const [busy, setBusy] = useState(false);

  // Self-gates
  if (!holdOrder || onChainSettlement) return null;

  if (!userAuth) {
    return (
      <div className="card" style={{ opacity: 0.7 }}>
        <div className="card-head">
          <span className="title">Settle on Arc</span>
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
          Sign in with a passkey to settle this booking on Arc Testnet.
        </div>
      </div>
    );
  }

  const phase = settlement.phase;
  const totalAmount = holdOrder.totalAmount;
  const totalCurrency = holdOrder.totalCurrency;

  async function settle() {
    if (busy) return;
    setBusy(true);
    setSettlementError(null);
    setSettlementPhase('signing');
    logEvent({
      group: SETTLE_LOG_GROUP,
      bullet: 'active',
      text: `pay(<span class="v">${totalAmount} USDC</span>) · attest(#${/* agentId filled below */ ''})`,
      t: now(),
    });

    try {
      const wallet = await restoreFromStorage();
      if (!wallet) {
        throw new Error('Session expired — sign in with your passkey again.');
      }

      const identity = await fetchAgentIdentity();
      const amountUnits = toUsdcUnits(totalAmount);

      const calls = [
        encodeUsdcTransfer(identity.providerAddress as any, amountUnits),
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
        explorerBase: EXPLORER_BASE,
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
      buttonLabel = busy ? 'Signing…' : `Pay + attest · sign once`;
      break;
    case 'signing':
      buttonLabel = 'Signing userOp · waiting for bundler…';
      buttonDisabled = true;
      buttonAction = null;
      break;
    case 'done':
      buttonLabel = 'Settled ✓';
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
      buttonLabel = 'Pay + attest · sign once';
  }

  const signerShort = `${userAuth.address.slice(0, 6)}…${userAuth.address.slice(-4)}`;

  return (
    <div className="card">
      <div className="card-head">
        <span className="title">Finalize on Arc</span>
        <span className="tag ink">1 passkey tap · gasless</span>
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
        One user operation, two atomic calls: transfer{' '}
        <strong style={{ color: 'var(--text)' }}>
          {totalAmount} {totalCurrency === 'USD' ? 'USDC' : totalCurrency}
        </strong>{' '}
        to the provider wallet on Arc, and log a +1 reputation attestation
        on the agent's ERC-8004 record. Arc pays its own gas.
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
          {settlement.txHashes.map((hash, i) => (
            <a
              key={hash + i}
              href={`${EXPLORER_BASE}/tx/${hash}`}
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
