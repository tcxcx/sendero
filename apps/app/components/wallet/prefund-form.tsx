'use client';

/**
 * "Pre-fund $X" form on the operator wallet page. Calls
 * `prefundTravelerAction` and renders the result inline. Shows the
 * deposit txHash + explorer link on success.
 */

import { useState, useTransition } from 'react';

import {
  prefundTravelerAction,
  type PrefundActionResult,
} from '@/app/(app)/dashboard/passport/[id]/wallet/prefund-action';

interface Props {
  travelerId: string;
  travelerAddress: string;
  defaultAmount?: string;
}

export function PrefundForm({ travelerId, travelerAddress, defaultAmount = '50' }: Props) {
  const [pending, startTransition] = useTransition();
  const [amount, setAmount] = useState(defaultAmount);
  const [result, setResult] = useState<PrefundActionResult | null>(null);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || pending) return;
    startTransition(async () => {
      const r = await prefundTravelerAction({
        travelerId,
        amount,
        sourceChain: 'Arc_Testnet',
      });
      setResult(r);
    });
  };

  return (
    <form
      onSubmit={onSubmit}
      style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 420 }}
    >
      <div className="t-meta">Pre-fund this traveler</div>
      <div className="t-body ink-70" style={{ fontSize: 12, lineHeight: 1.5 }}>
        Credits the traveler's unified balance directly from the platform treasury via{' '}
        <span className="t-mono">kit.depositFor</span>. No traveler signature required.
      </div>
      <div className="t-mono ink-60" style={{ fontSize: 11 }}>
        Destination: {travelerAddress.slice(0, 12)}…{travelerAddress.slice(-6)} on Arc Testnet
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <span className="t-mono ink-60" style={{ fontSize: 13 }}>
          $
        </span>
        <input
          type="text"
          inputMode="decimal"
          pattern="^\d+(\.\d{1,6})?$"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          disabled={pending}
          placeholder="50.00"
          style={{
            flex: 1,
            padding: '8px 12px',
            border: '1px solid var(--hairline-color)',
            borderRadius: 8,
            fontFamily: 'var(--font-mono-x)',
            fontSize: 14,
            background: 'var(--surface-base)',
          }}
        />
        <button
          type="submit"
          disabled={pending || !amount}
          style={{
            padding: '8px 18px',
            background: 'var(--vermillion)',
            color: '#fdfbf7',
            border: 0,
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 600,
            fontFamily: 'var(--font-sans)',
            cursor: pending ? 'wait' : 'pointer',
            opacity: pending ? 0.7 : 1,
          }}
        >
          {pending ? 'Sending…' : 'Pre-fund'}
        </button>
      </div>
      {result ? <ResultBanner result={result} /> : null}
    </form>
  );
}

function ResultBanner({ result }: { result: PrefundActionResult }) {
  if (result.kind === 'executed') {
    return (
      <div
        style={{
          fontSize: 11,
          padding: '8px 12px',
          borderRadius: 6,
          background: 'rgba(45,140,89,0.08)',
          color: 'var(--accent-green)',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        <span className="t-mono" style={{ fontWeight: 600 }}>
          ✓ Deposit submitted
        </span>
        {result.txHash ? (
          <span className="t-mono" style={{ fontSize: 10 }}>
            tx {result.txHash.slice(0, 16)}…
            {result.explorerUrl ? (
              <>
                {' · '}
                <a
                  href={result.explorerUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: 'inherit', textDecoration: 'underline' }}
                >
                  view
                </a>
              </>
            ) : null}
          </span>
        ) : (
          <span className="t-mono" style={{ fontSize: 10 }}>
            attempt {result.attemptId.slice(0, 8)}
          </span>
        )}
      </div>
    );
  }
  if (result.kind === 'treasury_missing') {
    return (
      <div className="t-mono ink-60" style={{ fontSize: 11 }}>
        TREASURY_PRIVATE_KEY not configured — set it in .env.local and reload.
      </div>
    );
  }
  if (result.kind === 'failed') {
    return (
      <div className="t-mono" style={{ fontSize: 11, color: 'var(--vermillion)' }}>
        ✗ {truncate(result.message, 160)}
      </div>
    );
  }
  // rejected
  return (
    <div className="t-mono" style={{ fontSize: 11, color: 'var(--vermillion)' }}>
      {result.message}
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
