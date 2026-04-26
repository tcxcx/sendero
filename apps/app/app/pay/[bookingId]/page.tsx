/**
 * /pay/[bookingId] — hosted payment page for off-app travelers.
 *
 * Public route: no Clerk session required. Auth is bearer-credential
 * via `?t=<token>` (BookingPayToken row, single-use, 30-min TTL by
 * default). The traveler taps a link delivered via WhatsApp / email,
 * sees the booking summary + amount, and confirms — the server
 * action reuses `executeTransferSpend` so the policy chain + App Kit
 * spend leg + TransferAttempt audit row match every other settle
 * surface exactly.
 *
 * Already-consumed / expired / wrong-booking cases short-circuit to
 * a state banner with no Pay button, so a leaked or replayed link
 * cannot move funds.
 */

import { notFound } from 'next/navigation';

import { verifyBookingPayToken, type VerifyResult } from '@/lib/pay-link/verify';

import { PayButton } from './pay-button';

export const dynamic = 'force-dynamic';

interface SearchParams {
  t?: string | string[];
}

export default async function PayPage({
  params,
  searchParams,
}: {
  params: Promise<{ bookingId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { bookingId } = await params;
  const { t } = await searchParams;
  const token = Array.isArray(t) ? t[0] : t;

  if (!token) notFound();

  const result = await verifyBookingPayToken({ token, bookingId });

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px 16px',
        background: 'var(--surface-base, #fdfbf7)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 520,
          background: 'var(--surface-raised, #ffffff)',
          boxShadow: 'inset 0 0 0 1px var(--hairline-color, rgba(31,42,68,0.12))',
          borderRadius: 12,
          padding: '28px 28px 24px',
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
        }}
      >
        {result.kind === 'ok' ? (
          <ConfirmCard result={result} bookingId={bookingId} token={token} />
        ) : (
          <RejectCard result={result} />
        )}
      </div>
    </main>
  );
}

function ConfirmCard({
  result,
  bookingId,
  token,
}: {
  result: Extract<VerifyResult, { kind: 'ok' }>;
  bookingId: string;
  token: string;
}) {
  const { booking, tenant } = result;
  const supplierName = booking.supplier?.name ?? 'this supplier';
  const amount = booking.totalUsd.toFixed(2);

  if (booking.status !== 'pending') {
    return (
      <>
        <Header tenantName={tenant.displayName} />
        <div className="t-h2" style={{ fontSize: 22 }}>
          {booking.status === 'confirmed' ? 'Already paid' : `Booking is ${booking.status}`}
        </div>
        <p className="t-body ink-70" style={{ fontSize: 14, lineHeight: 1.55 }}>
          {booking.status === 'confirmed'
            ? 'Your payment has been received and your booking is confirmed.'
            : 'This booking is no longer awaiting payment. Reach out to your travel operator for next steps.'}
        </p>
      </>
    );
  }

  return (
    <>
      <Header tenantName={tenant.displayName} />
      <div>
        <div className="t-meta" style={{ fontSize: 11 }}>
          {humanizeKind(booking.kind)}
        </div>
        <div className="t-h1" style={{ fontSize: 30, marginTop: 6, lineHeight: 1.1 }}>
          ${amount}
        </div>
        <div className="t-body ink-70" style={{ fontSize: 13, marginTop: 6 }}>
          {supplierName}
        </div>
      </div>

      <p className="t-body ink-70" style={{ fontSize: 13, lineHeight: 1.55 }}>
        Confirm to release {`$${amount}`} from your pre-funded balance to {supplierName}. This is a
        one-time spend tied to this booking.
      </p>

      <PayButton bookingId={bookingId} token={token} amount={amount} />

      <div
        className="t-mono ink-60"
        style={{ fontSize: 10, marginTop: 4, borderTop: '1px solid var(--hairline-color-soft, rgba(31,42,68,0.06))', paddingTop: 12 }}
      >
        Settled instantly on Arc Testnet via Circle Gateway. Single-use link · expires soon.
      </div>
    </>
  );
}

function RejectCard({ result }: { result: VerifyResult }) {
  if (result.kind === 'ok') return null;
  const { title, body } = rejectCopy(result.kind);
  return (
    <>
      <div
        className="t-meta"
        style={{ fontSize: 11, color: 'var(--vermillion, #cc4b37)' }}
      >
        Sendero
      </div>
      <div className="t-h2" style={{ fontSize: 22 }}>
        {title}
      </div>
      <p className="t-body ink-70" style={{ fontSize: 14, lineHeight: 1.55 }}>
        {body}
      </p>
    </>
  );
}

function Header({ tenantName }: { tenantName: string }) {
  return (
    <div className="t-meta" style={{ fontSize: 11, letterSpacing: 0.5 }}>
      {tenantName} · via Sendero
    </div>
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

function rejectCopy(kind: 'invalid' | 'expired' | 'consumed' | 'wrong_booking'): {
  title: string;
  body: string;
} {
  switch (kind) {
    case 'expired':
      return {
        title: 'This link has expired',
        body: 'Pay links are short-lived for safety. Ask your operator to send a fresh one.',
      };
    case 'consumed':
      return {
        title: 'This link has already been used',
        body: 'Each pay link works exactly once. If your booking still needs payment, ask your operator for a new link.',
      };
    case 'wrong_booking':
      return {
        title: "This link doesn't match this booking",
        body: 'The token in the URL belongs to a different booking. Use the link your operator sent you.',
      };
    case 'invalid':
      return {
        title: 'This link is not valid',
        body: 'The token is missing or malformed. Use the link your operator sent you exactly as received.',
      };
  }
}
