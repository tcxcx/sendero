/**
 * Public group-trip claim landing — `/group/<signed-token>`.
 *
 * The token is HMAC-signed (see `@sendero/tools/lib/group-claim-token`),
 * so the server can verify integrity without a session. The page:
 *
 *   1. Verifies the signature + tenant scoping.
 *   2. Looks up the GroupTrip (display name, destination, capacity,
 *      current passenger count).
 *   3. Renders a clean claim card. If the visitor isn't signed in,
 *      "Claim seat" bounces them through `/sign-in` with a redirect
 *      back to this URL — same Clerk pattern the rest of the app uses.
 *   4. POSTs to `/api/groups/claim/<token>` to bind the seat.
 *
 * Failure modes (tenant_mismatch, expired, bad_signature, malformed)
 * each render a specific message — never a 500. The token is the only
 * server-state input on this page; bad input never crashes the
 * renderer.
 *
 * Allowlisted in `apps/app/proxy.ts` so the page renders pre-auth.
 *
 * Spec: docs/architecture/concierge-magic.md adjacent — group-trip
 * closure plan #1.
 */

import { notFound } from 'next/navigation';

import { prisma } from '@sendero/database';
import { GroupClaimTokenError, verifyGroupClaimToken } from '@sendero/tools/lib/group-claim-token';

import { GroupClaimCard } from './claim-card';

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

interface ResolveError {
  kind: 'expired' | 'bad_signature' | 'malformed' | 'tenant_mismatch' | 'no_secret' | 'not_found';
  message: string;
}

async function resolveToken(
  token: string
): Promise<{ trip?: GroupTripView; error?: ResolveError }> {
  let payload;
  try {
    payload = await verifyGroupClaimToken(decodeURIComponent(token));
  } catch (err) {
    if (err instanceof GroupClaimTokenError) {
      return { error: { kind: err.code, message: err.message } };
    }
    return {
      error: { kind: 'malformed', message: err instanceof Error ? err.message : String(err) },
    };
  }

  const trip = await prisma.groupTrip.findFirst({
    where: { id: payload.groupTripId, tenantId: payload.tenantId },
    select: {
      id: true,
      name: true,
      destination: true,
      maxPassengers: true,
      _count: { select: { passengers: true } },
    },
  });
  if (!trip) {
    return {
      error: { kind: 'not_found', message: 'This group trip is no longer available.' },
    };
  }

  return {
    trip: {
      id: trip.id,
      name: trip.name,
      destination: trip.destination,
      maxPassengers: trip.maxPassengers,
      passengerCount: trip._count.passengers,
      remainingSeats:
        trip.maxPassengers != null
          ? Math.max(0, trip.maxPassengers - trip._count.passengers)
          : null,
      passengerSeatId: payload.passengerSeatId,
      role: payload.role,
      expiresAt: payload.exp,
    },
  };
}

export default async function GroupClaimPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { trip, error } = await resolveToken(token);

  if (error) {
    if (error.kind === 'not_found') notFound();
    return <ClaimErrorState error={error} />;
  }
  if (!trip) notFound();

  return <GroupClaimCard token={token} trip={trip} />;
}

function ClaimErrorState({ error }: { error: ResolveError }) {
  const headline =
    error.kind === 'expired'
      ? 'This invite expired'
      : error.kind === 'bad_signature' || error.kind === 'malformed'
        ? 'Invite link is broken'
        : error.kind === 'tenant_mismatch'
          ? 'Invite is for a different workspace'
          : 'Group not available';
  const body =
    error.kind === 'expired'
      ? 'Ask whoever shared this with you to mint a new claim link.'
      : error.kind === 'bad_signature' || error.kind === 'malformed'
        ? 'The link is malformed or has been tampered with. Ask the sender to share the original URL again.'
        : error.kind === 'tenant_mismatch'
          ? 'You may need to sign in to a different Sendero workspace before claiming this seat.'
          : 'The group trip you tried to join is no longer reachable.';
  return (
    <main className="mx-auto grid max-w-md gap-3 px-4 py-16">
      <h1 className="text-2xl font-semibold text-[color:var(--ink)]">{headline}</h1>
      <p className="text-sm text-[color:var(--text-dim)]">{body}</p>
      <p className="font-mono text-[11px] text-[color:var(--text-dim)]">reason: {error.kind}</p>
    </main>
  );
}
