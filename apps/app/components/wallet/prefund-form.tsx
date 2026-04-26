'use client';

/**
 * "Pre-fund $X" form on the operator wallet page. Calls
 * `prefundTravelerAction` and renders the result inline. Shows the
 * deposit txHash + explorer link on success.
 *
 * Step 5: when the operator picks a pending booking from the dropdown,
 * a successful prefund also issues a magic-link payment URL and
 * pushes it to the traveler over WhatsApp + email. The result banner
 * surfaces per-channel delivery outcomes.
 */

import { useMemo, useState, useTransition } from 'react';

import {
  prefundTravelerAction,
  type PrefundActionResult,
} from '@/app/(app)/dashboard/passport/[id]/wallet/prefund-action';

interface PendingBookingOption {
  id: string;
  kind: string;
  supplierName: string | null;
  amount: string;
  currency: string;
}

interface Props {
  travelerId: string;
  travelerAddress: string;
  defaultAmount?: string;
  /** Pending bookings on this traveler's open trips. Empty = top-up only. */
  pendingBookings?: PendingBookingOption[];
}

const NO_BOOKING_VALUE = '';

export function PrefundForm({
  travelerId,
  travelerAddress,
  defaultAmount = '50',
  pendingBookings = [],
}: Props) {
  const [pending, startTransition] = useTransition();
  const [amount, setAmount] = useState(defaultAmount);
  const [bookingId, setBookingId] = useState<string>(NO_BOOKING_VALUE);
  const [result, setResult] = useState<PrefundActionResult | null>(null);

  // When the operator picks a booking, default-suggest its amount so
  // the prefund covers exactly the spend the magic link will release.
  // The operator can still override the field manually.
  const onPickBooking = (id: string) => {
    setBookingId(id);
    if (id) {
      const b = pendingBookings.find(x => x.id === id);
      if (b) setAmount(b.amount);
    }
  };

  const selectedBooking = useMemo(
    () => pendingBookings.find(b => b.id === bookingId) ?? null,
    [pendingBookings, bookingId]
  );

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || pending) return;
    startTransition(async () => {
      const r = await prefundTravelerAction({
        travelerId,
        amount,
        sourceChain: 'Arc_Testnet',
        bookingId: bookingId || undefined,
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

      {pendingBookings.length > 0 ? (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="t-meta" style={{ fontSize: 10 }}>
            Also send pay link for…
          </span>
          <select
            value={bookingId}
            onChange={e => onPickBooking(e.target.value)}
            disabled={pending}
            style={{
              padding: '8px 12px',
              border: '1px solid var(--hairline-color)',
              borderRadius: 8,
              fontFamily: 'var(--font-mono-x)',
              fontSize: 12,
              background: 'var(--surface-base)',
            }}
          >
            <option value={NO_BOOKING_VALUE}>— top-up only, no link —</option>
            {pendingBookings.map(b => (
              <option key={b.id} value={b.id}>
                {b.currency} {b.amount} · {humanizeKind(b.kind)}
                {b.supplierName ? ` · ${b.supplierName}` : ''}
              </option>
            ))}
          </select>
        </label>
      ) : null}

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
          {pending ? 'Sending…' : selectedBooking ? 'Pre-fund + send link' : 'Pre-fund'}
        </button>
      </div>
      {result ? <ResultBanner result={result} /> : null}
    </form>
  );
}

function humanizeKind(kind: string): string {
  switch (kind) {
    case 'flight':
      return 'Flight';
    case 'stay':
      return 'Stay';
    case 'rail':
      return 'Rail';
    case 'car':
      return 'Car';
    default:
      return kind.charAt(0).toUpperCase() + kind.slice(1);
  }
}

function ResultBanner({ result }: { result: PrefundActionResult }) {
  if (result.kind === 'executed') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
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
        {result.delivery ? <DeliveryBanner delivery={result.delivery} /> : null}
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

function DeliveryBanner({
  delivery,
}: {
  delivery: NonNullable<Extract<PrefundActionResult, { kind: 'executed' }>['delivery']>;
}) {
  const okChannels = delivery.channels.filter(c => c.ok).map(c => c.channel);
  const failedChannels = delivery.channels.filter(c => !c.ok);

  if (delivery.kind === 'rejected') {
    return (
      <div
        className="t-mono"
        style={{ fontSize: 10.5, color: 'var(--vermillion)', padding: '6px 12px' }}
      >
        Link delivery rejected: {delivery.message ?? 'unknown reason'}
      </div>
    );
  }

  if (delivery.kind === 'no_channels') {
    return (
      <div
        className="t-mono ink-60"
        style={{
          fontSize: 10.5,
          padding: '6px 12px',
          borderRadius: 6,
          background: 'rgba(204,75,55,0.06)',
        }}
      >
        Pay link could not be delivered.{' '}
        {failedChannels.map(c => `${c.channel}: ${c.reason ?? 'failed'}`).join(' · ') ||
          'No traveler channels configured.'}
      </div>
    );
  }

  return (
    <div
      className="t-mono"
      style={{
        fontSize: 10.5,
        padding: '6px 12px',
        borderRadius: 6,
        background: 'rgba(45,140,89,0.06)',
        color: 'var(--accent-green)',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}
    >
      <span style={{ fontWeight: 600 }}>
        ✓ Pay link sent · {okChannels.join(' + ') || '—'}
      </span>
      {failedChannels.length > 0 ? (
        <span style={{ color: 'rgba(31,42,68,0.6)' }}>
          (also tried{' '}
          {failedChannels.map(c => `${c.channel}: ${c.reason ?? 'failed'}`).join(', ')})
        </span>
      ) : null}
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
