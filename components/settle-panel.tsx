'use client';

/**
 * SettlePanel — user-signed ERC-8183 settlement flow.
 *
 * Three passkey-signed user operations, interleaved with two provider-signed
 * backend transactions:
 *
 *   1. createJob + approve USDC (user op)
 *      → POST /api/settle/start (provider setBudget)
 *   2. fund (user op)
 *      → POST /api/settle/submit (provider submitDeliverable)
 *   3. complete + giveFeedback (user op)
 *      → POST /api/settle/finalize (cache bust)
 *
 * Reads user MSCA from persisted passkey credential. Self-gates on
 * `holdOrder` + absence of `onChainSettlement`.
 */

import { useCallback, useRef, useState } from 'react';
import { createPublicClient, decodeEventLog, http, type Address, type Hex } from 'viem';
import { arcTestnet } from 'viem/chains';

import { usePasillo } from './store';
import { restoreFromStorage, sendUserOp, type UserWallet } from '@/lib/user-wallet';
import {
  AGENTIC_COMMERCE_ADDRESS,
  JOB_CREATED_EVENT,
  encodeApproveUsdc,
  encodeComplete,
  encodeCreateJob,
  encodeFund,
  encodeGiveFeedback,
  hashReason,
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
  // Prefer NEXT_PUBLIC env vars if present, else fall back to the server route.
  const envProvider = process.env.NEXT_PUBLIC_PASILLO_PROVIDER_ADDRESS;
  const envAgentId = process.env.NEXT_PUBLIC_PASILLO_AGENT_ID;
  if (envProvider && envAgentId) {
    return { agentId: envAgentId, providerAddress: envProvider };
  }
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

function publicClient() {
  return createPublicClient({ chain: arcTestnet, transport: http() });
}

async function decodeJobIdFromReceipt(txHash: Hex): Promise<bigint> {
  const client = publicClient();
  const receipt = await client.getTransactionReceipt({ hash: txHash });
  const logs = receipt.logs as unknown as Array<{
    address: Hex;
    data: Hex;
    topics: [Hex, ...Hex[]] | [];
  }>;
  for (const log of logs) {
    if (
      log.address.toLowerCase() !== AGENTIC_COMMERCE_ADDRESS.toLowerCase()
    )
      continue;
    try {
      const decoded = decodeEventLog({
        abi: [JOB_CREATED_EVENT],
        data: log.data,
        topics: log.topics,
      }) as { eventName: string; args: { jobId: bigint } };
      if (decoded.eventName === 'JobCreated') {
        return decoded.args.jobId;
      }
    } catch {
      /* try next log */
    }
  }
  throw new Error('JobCreated event not found in tx receipt');
}

export function SettlePanel() {
  const holdOrder = usePasillo((s) => s.holdOrder);
  const onChainSettlement = usePasillo((s) => s.onChainSettlement);
  const settlement = usePasillo((s) => s.settlement);
  const userAuth = usePasillo((s) => s.userAuth);

  const setSettlementPhase = usePasillo((s) => s.setSettlementPhase);
  const setSettlementJobId = usePasillo((s) => s.setSettlementJobId);
  const pushSettlementTx = usePasillo((s) => s.pushSettlementTx);
  const setSettlementError = usePasillo((s) => s.setSettlementError);
  const setLastUserOpHash = usePasillo((s) => s.setLastUserOpHash);
  const resetSettlement = usePasillo((s) => s.resetSettlement);
  const setOnChainSettlement = usePasillo((s) => s.setOnChainSettlement);
  const logEvent = usePasillo((s) => s.logEvent);

  const [busy, setBusy] = useState(false);
  const deliverableHashRef = useRef<Hex | null>(null);
  const agentIdRef = useRef<string | null>(null);

  async function restoreWalletOrFail(): Promise<UserWallet | null> {
    const w = await restoreFromStorage();
    if (!w) {
      setSettlementError('session expired — sign in again');
      logEvent({
        group: SETTLE_LOG_GROUP,
        bullet: 'fail',
        text: 'error: session expired',
        t: now(),
      });
      return null;
    }
    return w;
  }

  const startOpenPhase = useCallback(async () => {
    if (!holdOrder) return;
    setBusy(true);
    setSettlementError(null);
    setSettlementPhase('userop-create');
    logEvent({
      group: SETTLE_LOG_GROUP,
      bullet: 'active',
      text: `createJob + approveUsdc(<span class="v">${holdOrder.totalAmount} USDC</span>)`,
      t: now(),
    });
    try {
      const wallet = await restoreWalletOrFail();
      if (!wallet) return;

      const identity = await fetchAgentIdentity();
      agentIdRef.current = identity.agentId;

      const amount = toUsdcUnits(holdOrder.totalAmount);
      const expiredAt = BigInt(Math.floor(Date.now() / 1000) + 3600);

      const calls = [
        encodeCreateJob({
          provider: identity.providerAddress as Address,
          evaluator: wallet.address as Address,
          expiredAt,
          description: `PNR ${holdOrder.bookingReference}`,
        }),
        encodeApproveUsdc(AGENTIC_COMMERCE_ADDRESS, amount),
      ];

      const { txHash, userOpHash } = await sendUserOp(wallet, calls);
      pushSettlementTx(txHash);
      setLastUserOpHash(userOpHash);

      const jobId = await decodeJobIdFromReceipt(txHash);
      setSettlementJobId(jobId.toString());

      logEvent({
        group: SETTLE_LOG_GROUP,
        bullet: 'done',
        text: `userOp 1/3 landed · job <span class="v">#${jobId.toString()}</span>`,
        t: now(),
      });

      // Server phase: setBudget
      setSettlementPhase('server-budget');
      logEvent({
        group: SETTLE_LOG_GROUP,
        bullet: 'active',
        text: `provider setBudget(<span class="v">${holdOrder.totalAmount} USDC</span>)`,
        t: now(),
      });
      const res = await fetch('/api/settle/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jobId: jobId.toString(),
          totalAmountUsdc: holdOrder.totalAmount,
        }),
      });
      const data = (await res.json()) as {
        budgetTxHash?: string;
        error?: string;
        message?: string;
      };
      if (!res.ok || !data.budgetTxHash) {
        throw new Error(
          data.message || data.error || `setBudget failed (${res.status})`,
        );
      }
      pushSettlementTx(data.budgetTxHash);
      logEvent({
        group: SETTLE_LOG_GROUP,
        bullet: 'done',
        text: `setBudget landed`,
        t: now(),
      });

      setSettlementPhase('userop-fund');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSettlementError(msg);
      logEvent({
        group: SETTLE_LOG_GROUP,
        bullet: 'fail',
        text: `error: ${msg}`,
        t: now(),
      });
    } finally {
      setBusy(false);
    }
  }, [
    holdOrder,
    logEvent,
    pushSettlementTx,
    setLastUserOpHash,
    setSettlementError,
    setSettlementJobId,
    setSettlementPhase,
  ]);

  const startFundPhase = useCallback(async () => {
    if (!holdOrder) return;
    const jobIdStr = settlement.jobId;
    if (!jobIdStr) {
      setSettlementError('missing jobId');
      return;
    }
    setBusy(true);
    setSettlementError(null);
    setSettlementPhase('userop-fund');
    logEvent({
      group: SETTLE_LOG_GROUP,
      bullet: 'active',
      text: `fund(<span class="v">#${jobIdStr}</span>)`,
      t: now(),
    });
    try {
      const wallet = await restoreWalletOrFail();
      if (!wallet) return;

      const jobId = BigInt(jobIdStr);
      const { txHash, userOpHash } = await sendUserOp(wallet, [
        encodeFund(jobId),
      ]);
      pushSettlementTx(txHash);
      setLastUserOpHash(userOpHash);
      logEvent({
        group: SETTLE_LOG_GROUP,
        bullet: 'done',
        text: `userOp 2/3 landed`,
        t: now(),
      });

      setSettlementPhase('server-submit');
      logEvent({
        group: SETTLE_LOG_GROUP,
        bullet: 'active',
        text: `provider submit(keccak256(PNR))`,
        t: now(),
      });
      const res = await fetch('/api/settle/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jobId: jobIdStr,
          pnr: holdOrder.bookingReference,
        }),
      });
      const data = (await res.json()) as {
        submitTxHash?: string;
        deliverableHash?: string;
        error?: string;
        message?: string;
      };
      if (!res.ok || !data.submitTxHash || !data.deliverableHash) {
        throw new Error(
          data.message || data.error || `submit failed (${res.status})`,
        );
      }
      pushSettlementTx(data.submitTxHash);
      deliverableHashRef.current = data.deliverableHash as Hex;
      logEvent({
        group: SETTLE_LOG_GROUP,
        bullet: 'done',
        text: `submit landed · deliverable <span class="v">${data.deliverableHash.slice(0, 10)}…</span>`,
        t: now(),
      });

      setSettlementPhase('userop-complete');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSettlementError(msg);
      logEvent({
        group: SETTLE_LOG_GROUP,
        bullet: 'fail',
        text: `error: ${msg}`,
        t: now(),
      });
    } finally {
      setBusy(false);
    }
  }, [
    holdOrder,
    logEvent,
    pushSettlementTx,
    setLastUserOpHash,
    setSettlementError,
    setSettlementPhase,
    settlement.jobId,
  ]);

  const startCompletePhase = useCallback(async () => {
    if (!holdOrder) return;
    const jobIdStr = settlement.jobId;
    if (!jobIdStr) {
      setSettlementError('missing jobId');
      return;
    }
    setBusy(true);
    setSettlementError(null);
    setSettlementPhase('userop-complete');
    logEvent({
      group: SETTLE_LOG_GROUP,
      bullet: 'active',
      text: `complete + giveFeedback(<span class="v">#${jobIdStr}</span>)`,
      t: now(),
    });
    try {
      const wallet = await restoreWalletOrFail();
      if (!wallet) return;

      // Resolve agentId if we lost it (page reload mid-flow).
      let agentIdStr = agentIdRef.current;
      if (!agentIdStr) {
        const id = await fetchAgentIdentity();
        agentIdStr = id.agentId;
        agentIdRef.current = agentIdStr;
      }

      const jobId = BigInt(jobIdStr);
      const reasonHash = hashReason('ticket_issued');
      const calls = [
        encodeComplete(jobId, reasonHash),
        encodeGiveFeedback({
          agentId: BigInt(agentIdStr),
          score: 95,
          tag: 'ticket_delivered',
        }),
      ];
      const { txHash, userOpHash } = await sendUserOp(wallet, calls);
      // The bundler returns a single tx hash that covers both batched calls.
      // The on-chain TX_LABELS in SettlementCard expect 7 hashes in order:
      // createJob, setBudget, approve, fund, submit, complete, feedback.
      // We push the same hash twice so indices 5 and 6 both link to the tx
      // that actually contains the complete + giveFeedback calls.
      pushSettlementTx(txHash);
      pushSettlementTx(txHash);
      setLastUserOpHash(userOpHash);
      logEvent({
        group: SETTLE_LOG_GROUP,
        bullet: 'done',
        text: `userOp 3/3 landed · feedback ★95`,
        t: now(),
      });

      // Fire-and-forget cache invalidation.
      fetch('/api/settle/finalize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agentId: agentIdStr }),
      }).catch(() => {
        /* ignore */
      });

      // Read the full list directly from the store to capture every tx we
      // collected during this flow (state closure may be stale here).
      const finalHashes = usePasillo.getState().settlement.txHashes;

      setOnChainSettlement({
        jobId: jobIdStr,
        pnr: holdOrder.bookingReference,
        deliverableHash:
          deliverableHashRef.current ??
          ('0x' + '0'.repeat(64)),
        txHashes: finalHashes,
        explorerBase: EXPLORER_BASE,
        completedAt: Date.now(),
        demo: false,
      });
      setSettlementPhase('done');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSettlementError(msg);
      logEvent({
        group: SETTLE_LOG_GROUP,
        bullet: 'fail',
        text: `error: ${msg}`,
        t: now(),
      });
    } finally {
      setBusy(false);
    }
  }, [
    holdOrder,
    logEvent,
    pushSettlementTx,
    setLastUserOpHash,
    setOnChainSettlement,
    setSettlementError,
    setSettlementPhase,
    settlement.jobId,
  ]);

  // Self-gate — after all hooks to respect Rules of Hooks.
  if (!holdOrder || onChainSettlement) return null;

  if (!userAuth) {
    return (
      <div className="card" style={{ opacity: 0.7 }}>
        <div className="card-head">
          <span className="title">Settle on Arc · ERC-8183 + ERC-8004</span>
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

  let buttonLabel = 'Open escrow · sign userOp 1/3';
  let buttonDisabled = busy;
  let buttonAction: (() => void) | null = startOpenPhase;

  switch (phase) {
    case 'idle':
      buttonLabel = busy ? 'Signing…' : 'Open escrow · sign userOp 1/3';
      buttonAction = startOpenPhase;
      break;
    case 'userop-create':
      buttonLabel = 'Signing userOp 1/3…';
      buttonDisabled = true;
      buttonAction = null;
      break;
    case 'server-budget':
      buttonLabel = 'Waiting on provider setBudget…';
      buttonDisabled = true;
      buttonAction = null;
      break;
    case 'userop-fund':
      buttonLabel = busy ? 'Signing userOp 2/3…' : 'Fund escrow · sign userOp 2/3';
      buttonDisabled = busy;
      buttonAction = startFundPhase;
      break;
    case 'server-submit':
      buttonLabel = 'Waiting on provider submit…';
      buttonDisabled = true;
      buttonAction = null;
      break;
    case 'userop-complete':
      buttonLabel = busy
        ? 'Signing userOp 3/3…'
        : 'Close + rate · sign userOp 3/3';
      buttonDisabled = busy;
      buttonAction = startCompletePhase;
      break;
    case 'done':
      buttonLabel = 'Settled ✓';
      buttonDisabled = true;
      buttonAction = null;
      break;
    case 'error':
      buttonLabel = 'Retry';
      buttonDisabled = false;
      buttonAction = () => resetSettlement();
      break;
  }

  const liveHint = liveStatusHint(phase, busy);

  return (
    <div className="card">
      <div className="card-head">
        <span className="title">Finalize on Arc · ERC-8183 escrow</span>
        <span className="tag ink">3 passkey taps · gasless</span>
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
        Book your seat on-chain: open an escrow job, fund it with USDC,
        then close it with a feedback rating. Three biometric taps total.
        Arc pays its own gas — you don't spend anything other than USDC.
      </div>

      <div className="settle-grid">
        <StepCell
          index={1}
          title="Open + approve"
          subtitle="createJob · approve USDC"
          state={stepState(phase, ['userop-create', 'server-budget'], [
            'userop-fund',
            'server-submit',
            'userop-complete',
            'done',
          ])}
        />
        <StepCell
          index={2}
          title="Fund escrow"
          subtitle="lock USDC until ticket confirmed"
          state={stepState(phase, ['userop-fund', 'server-submit'], [
            'userop-complete',
            'done',
          ])}
        />
        <StepCell
          index={3}
          title="Close + rate"
          subtitle="release funds · leave reputation"
          state={stepState(phase, ['userop-complete'], ['done'])}
        />
        <div className="settle-cell">
          <span className="k">Signer</span>
          <span className="v mono-v">
            {userAuth.address.slice(0, 6)}…{userAuth.address.slice(-4)}
          </span>
          <span className="k">your wallet</span>
        </div>
      </div>

      {liveHint && (
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
          {liveHint}
        </div>
      )}

      {phase === 'error' && settlement.error && (
        <div
          style={{
            padding: '10px 16px',
            borderTop: '1px solid var(--border)',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            color: 'var(--accent-rose)',
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
          alignItems: 'center',
        }}
      >
        {settlement.jobId && (
          <span
            style={{
              marginRight: 'auto',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--text-dim)',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            Job #{settlement.jobId}
          </span>
        )}
        <button
          className="btn primary"
          disabled={buttonDisabled || !buttonAction}
          onClick={() => buttonAction?.()}
        >
          {buttonLabel}
        </button>
      </div>

      {settlement.txHashes.length > 0 && (
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              letterSpacing: '0.08em',
              color: 'var(--text-dim)',
              textTransform: 'uppercase',
              marginBottom: 8,
            }}
          >
            On-chain transactions ({settlement.txHashes.length}/7)
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {settlement.txHashes.map((hash, i) => (
              <a
                key={`${hash}-${i}`}
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
                  transition: 'all 0.12s',
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor =
                    'var(--ink)';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor =
                    'var(--border)';
                }}
              >
                <span style={{ color: 'var(--accent-green)' }}>●</span>
                <span style={{ color: 'var(--text-dim)' }}>
                  #{i + 1} {TX_LABELS[i] ?? ''}
                </span>
                <span style={{ color: 'var(--ink)' }}>
                  {hash.slice(0, 10)}…{hash.slice(-4)}
                </span>
                <span style={{ color: 'var(--text-faint)', fontSize: 10 }}>↗</span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const TX_LABELS = [
  'createJob',
  'setBudget',
  'approve USDC',
  'fund',
  'submit (PNR hash)',
  'complete',
  'giveFeedback',
];

function liveStatusHint(phase: string, busy: boolean): string | null {
  if (phase === 'userop-create')
    return busy
      ? 'Signing userOp 1/3 · waiting for passkey, then bundler → Arc…'
      : 'Ready — approve on your device';
  if (phase === 'server-budget')
    return 'Provider pinning the budget on Arc · ~10s';
  if (phase === 'userop-fund')
    return busy
      ? 'Signing userOp 2/3 · escrowing USDC to the ERC-8183 job…'
      : 'Escrow opened — fund it to confirm your seat';
  if (phase === 'server-submit')
    return 'Provider submitting PNR hash (keccak256) on-chain · ~10s';
  if (phase === 'userop-complete')
    return busy
      ? 'Signing userOp 3/3 · releasing escrow + rating the agent…'
      : 'Ticket confirmed — leave feedback to close the loop';
  return null;
}

type StepState = 'pending' | 'active' | 'done';

function stepState(
  phase: string,
  activePhases: string[],
  donePhases: string[],
): StepState {
  if (activePhases.includes(phase)) return 'active';
  if (donePhases.includes(phase)) return 'done';
  return 'pending';
}

function StepCell({
  index,
  title,
  subtitle,
  state,
}: {
  index: number;
  title: string;
  subtitle: string;
  state: StepState;
}) {
  const dotColor =
    state === 'done'
      ? 'var(--accent-green)'
      : state === 'active'
        ? 'var(--ink)'
        : 'var(--text-faint)';
  const titleColor =
    state === 'pending' ? 'var(--text-faint)' : 'var(--text)';
  const badge =
    state === 'done'
      ? '✓ done'
      : state === 'active'
        ? 'signing…'
        : 'pending';
  return (
    <div className="settle-cell">
      <span className="k">Step {index}</span>
      <span
        className="v"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          color: titleColor,
          fontSize: 14,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: dotColor,
            display: 'inline-block',
            flexShrink: 0,
            animation: state === 'active' ? 'blink 1s infinite' : 'none',
          }}
        />
        {title}
      </span>
      <span className="k">
        {subtitle} · {badge}
      </span>
    </div>
  );
}
