'use client';

/**
 * Client claim card for `/group/[token]`. Renders the group state +
 * a primary "Claim seat" button. Tap → POSTs to the claim API; if the
 * visitor isn't signed in, the API replies 401 and we bounce through
 * `/sign-in?redirect_url=…` (Clerk-native).
 *
 * Kept lean — this is the first thing the invitee sees, so no
 * marketing chrome. The page above (`page.tsx`) handles error states.
 */

import { useState } from 'react';

import { useUser } from '@clerk/nextjs';

interface GroupTripView {
  id: string;
  name: string;
  destination: string | null;
  maxPassengers: number | null;
  passengerCount: number;
  remainingSeats: number | null;
  passengerSeatId: string | null;
  role: string;
  expiresAt: number;
}

export function GroupClaimCard({ token, trip }: { token: string; trip: GroupTripView }) {
  const { isSignedIn, user } = useUser();
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<
    | { ok: true; passengerCount: number; remainingSeats: number | null }
    | { ok: false; error: string }
    | null
  >(null);

  const expiresAt = new Date(trip.expiresAt * 1000);
  const expiresIn = Math.max(0, Math.floor((trip.expiresAt * 1000 - Date.now()) / 86_400_000));
  const subline = trip.destination ?? 'Group trip';
  const seatLine =
    trip.remainingSeats === 0
      ? 'Group full — someone needs to drop a seat first.'
      : trip.remainingSeats != null
        ? `${trip.passengerCount} of ${trip.maxPassengers} claimed · ${trip.remainingSeats} left`
        : `${trip.passengerCount} claimed`;

  async function claim() {
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch(`/api/groups/claim/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: trip.role }),
      });
      if (res.status === 401) {
        // Bounce through sign-in then back to this page.
        window.location.href = `/sign-in?redirect_url=${encodeURIComponent(window.location.pathname)}`;
        return;
      }
      const payload = (await res.json()) as
        | { ok: true; passengerCount: number; remainingSeats: number | null }
        | { ok: false; error: string };
      setResult(payload);
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto grid max-w-md gap-4 px-4 py-12">
      <header className="grid gap-1">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[color:var(--text-dim)]">
          You're invited to a group trip
        </p>
        <h1 className="text-2xl font-semibold text-[color:var(--ink)]">{trip.name}</h1>
        {trip.destination ? (
          <p className="text-sm text-[color:var(--text-dim)]">{subline}</p>
        ) : null}
      </header>

      <section className="grid gap-2 rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-soft)] px-4 py-3 text-sm">
        <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-[color:var(--text-dim)]">
          Seats
        </div>
        <div className="text-[color:var(--ink)]">{seatLine}</div>
        <div className="font-mono text-[11px] text-[color:var(--text-dim)]">
          Role: {trip.role} · Expires in {expiresIn}d ({expiresAt.toLocaleDateString()})
        </div>
      </section>

      {renderResult({
        result,
        trip,
        isSignedIn: isSignedIn ?? false,
        user,
        submitting,
        onClaim: claim,
      })}
    </main>
  );
}

type ClaimResult =
  | { ok: true; passengerCount: number; remainingSeats: number | null }
  | { ok: false; error: string };

function renderResult(args: {
  result: ClaimResult | null;
  trip: GroupTripView;
  isSignedIn: boolean;
  user: ReturnType<typeof useUser>['user'];
  submitting: boolean;
  onClaim: () => void;
}) {
  const { result, trip, isSignedIn, user, submitting, onClaim } = args;
  if (result === null) {
    return (
      <button
        type="button"
        onClick={onClaim}
        disabled={submitting || trip.remainingSeats === 0}
        className="rounded-full bg-[color:var(--ink)] px-5 py-3 text-center text-sm font-semibold text-[color:#fdfbf7] transition disabled:opacity-50"
      >
        {submitting
          ? 'Claiming…'
          : trip.remainingSeats === 0
            ? 'Group full'
            : isSignedIn
              ? `Claim my seat${user?.firstName ? ` · ${user.firstName}` : ''}`
              : 'Sign in to claim'}
      </button>
    );
  }
  if (result.ok) {
    return (
      <div className="rounded-2xl border border-[color:var(--accent-green)] bg-[color:var(--bg-soft)] px-4 py-3 text-sm text-[color:var(--ink)]">
        ✓ You&rsquo;re in. {result.passengerCount} passengers
        {result.remainingSeats != null ? ` · ${result.remainingSeats} seats left` : ''}.
        <p className="pt-2 text-xs text-[color:var(--text-dim)]">
          We&rsquo;ll WhatsApp you next steps. You can also{' '}
          <a href="/me" className="text-[color:var(--ink)] underline-offset-2 hover:underline">
            open your trips
          </a>
          .
        </p>
      </div>
    );
  }
  const errorMessage = 'error' in result ? result.error : 'unknown';
  return (
    <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-soft)] px-4 py-3 text-sm">
      <p className="font-medium text-[color:var(--ink)]">Couldn&rsquo;t claim that seat.</p>
      <p className="font-mono text-[11px] text-[color:var(--text-dim)]">{errorMessage}</p>
    </div>
  );
}
