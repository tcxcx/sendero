'use client';

/**
 * Pay button for the hosted /pay/[bookingId] page. Calls the magic-link
 * action and renders the result inline. On success the page revalidates
 * so a follow-up tap shows the "already paid" state, not a stale form.
 */

import { useState, useTransition } from 'react';

import { payByLinkAction, type PayLinkResult } from './pay-action';

interface Props {
  bookingId: string;
  token: string;
  amount: string;
}

export function PayButton({ bookingId, token, amount }: Props) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<PayLinkResult | null>(null);

  const onClick = () => {
    if (pending) return;
    startTransition(async () => {
      const r = await payByLinkAction({ bookingId, token });
      setResult(r);
    });
  };

  if (result?.kind === 'executed') {
    return (
      <div
        style={{
          padding: '14px 16px',
          borderRadius: 10,
          background: 'rgba(45,140,89,0.08)',
          color: 'var(--accent-green, #2d8c59)',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        <div className="t-mono" style={{ fontWeight: 600, fontSize: 13 }}>
          ✓ Payment confirmed · ${result.amount}
        </div>
        {result.txHash ? (
          <div className="t-mono" style={{ fontSize: 11 }}>
            tx {result.txHash.slice(0, 16)}…
          </div>
        ) : null}
        <div className="t-body" style={{ fontSize: 12, marginTop: 2 }}>
          Your operator has been notified. You can close this page.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        style={{
          padding: '14px 18px',
          background: 'var(--vermillion, #cc4b37)',
          color: '#fdfbf7',
          border: 0,
          borderRadius: 10,
          fontSize: 15,
          fontWeight: 600,
          fontFamily: 'var(--font-sans)',
          cursor: pending ? 'wait' : 'pointer',
          opacity: pending ? 0.7 : 1,
        }}
      >
        {pending ? 'Confirming…' : `Confirm payment · $${amount}`}
      </button>
      {result ? <ResultBanner result={result} /> : null}
    </div>
  );
}

function ResultBanner({ result }: { result: PayLinkResult }) {
  if (result.kind === 'executed') return null;
  if (result.kind === 'pending') {
    return (
      <div className="t-mono ink-70" style={{ fontSize: 11 }}>
        Pending: {result.reason}. Try again in a moment.
      </div>
    );
  }
  if (result.kind === 'blocked') {
    return (
      <div className="t-mono" style={{ fontSize: 11, color: 'var(--vermillion, #cc4b37)' }}>
        Blocked: {result.reason}
      </div>
    );
  }
  if (result.kind === 'delegate_missing') {
    return (
      <div className="t-mono" style={{ fontSize: 11, color: 'var(--vermillion, #cc4b37)' }}>
        Spend delegate not configured. Contact your operator.
      </div>
    );
  }
  if (result.kind === 'failed') {
    return (
      <div className="t-mono" style={{ fontSize: 11, color: 'var(--vermillion, #cc4b37)' }}>
        Failed: {truncate(result.message, 200)}
      </div>
    );
  }
  // rejected
  return (
    <div className="t-mono" style={{ fontSize: 11, color: 'var(--vermillion, #cc4b37)' }}>
      {result.message}
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
