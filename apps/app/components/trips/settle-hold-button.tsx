'use client';

/**
 * Vermillion "Settle $X.XX" CTA wired to `settleHoldAction`. Shown next
 * to a pending Booking on the trip detail card and reused by the
 * MetaInbox approval slot.
 *
 * On click: dispatches the server action, surfaces success / blocked /
 * pending / delegate-missing / failed states inline. Trace is rendered
 * as a stacked list of guards when the chain blocked the transfer.
 */

import { useState, useTransition } from 'react';

import {
  settleHoldAction,
  type SettleHoldResult,
} from '@/app/(app)/dashboard/trips/[id]/settle-action';

interface Props {
  tripId: string;
  bookingId: string;
  amountUsd: string;
  variant?: 'card' | 'inbox';
}

export function SettleHoldButton({ tripId, bookingId, amountUsd, variant = 'card' }: Props) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<SettleHoldResult | null>(null);

  const onClick = () => {
    startTransition(async () => {
      const r = await settleHoldAction({ tripId, bookingId });
      setResult(r);
    });
  };

  const label = pending ? 'Settling…' : `Settle $${formatAmount(amountUsd)}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        style={
          variant === 'inbox'
            ? {
                padding: '6px 14px',
                background: 'var(--vermillion)',
                color: '#fdfbf7',
                border: 0,
                borderRadius: 8,
                fontSize: 11,
                fontWeight: 600,
                fontFamily: 'var(--font-sans)',
                cursor: pending ? 'wait' : 'pointer',
                opacity: pending ? 0.7 : 1,
              }
            : {
                padding: '7px 14px',
                background: 'var(--vermillion)',
                color: '#fdfbf7',
                border: 0,
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 600,
                fontFamily: 'var(--font-sans)',
                cursor: pending ? 'wait' : 'pointer',
                opacity: pending ? 0.7 : 1,
                alignSelf: 'flex-start',
              }
        }
      >
        {label}
      </button>
      {result ? <ResultBanner result={result} /> : null}
    </div>
  );
}

function ResultBanner({ result }: { result: SettleHoldResult }) {
  if (result.kind === 'executed') {
    return (
      <div className="t-mono" style={{ fontSize: 11, color: 'var(--accent-green)' }}>
        ✓ Settled · tx{' '}
        {result.txHash ? result.txHash.slice(0, 12) + '…' : result.attemptId.slice(0, 8)}
      </div>
    );
  }
  if (result.kind === 'pending') {
    return (
      <div className="t-mono ink-60" style={{ fontSize: 11 }}>
        Awaiting manager review — {result.reason}
      </div>
    );
  }
  if (result.kind === 'blocked') {
    return (
      <div
        style={{
          fontSize: 11,
          padding: '6px 10px',
          borderRadius: 6,
          background: 'rgba(217,79,52,0.08)',
          color: 'var(--vermillion)',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          maxWidth: 360,
        }}
      >
        <span className="t-mono" style={{ fontWeight: 600 }}>
          Blocked: {result.reason}
        </span>
        {result.trace.map((t, i) => (
          <span key={i} className="t-mono" style={{ fontSize: 10, opacity: 0.85 }}>
            {t.allowed ? '·' : '✗'} {t.guard ?? 'chain'}
            {t.reason ? ` — ${t.reason}` : ''}
          </span>
        ))}
      </div>
    );
  }
  if (result.kind === 'delegate_missing') {
    return (
      <div className="t-mono ink-60" style={{ fontSize: 11 }}>
        Policy passed; on-chain leg waiting on delegate signer.
      </div>
    );
  }
  if (result.kind === 'failed') {
    return (
      <div className="t-mono" style={{ fontSize: 11, color: 'var(--vermillion)' }}>
        ✗ {truncate(result.message, 120)}
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

function formatAmount(amount: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return amount;
  if (n === 0) return '0';
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  return n.toFixed(0);
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
