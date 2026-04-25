'use server';

/**
 * Server action for the buyer cancel-sweep dashboard page
 * (`/dashboard/trips/[id]/cancel?reason=lockout`).
 *
 * The legitimate buyer can land here in two ways:
 *   1. Click-through from a `claim_lockout` SecurityAlert email/Slack
 *      ping (the deep link the indexer-side `handleClaimLockoutTriggered`
 *      handler stamps into the alert payload).
 *   2. Manually navigate when they suspect the link / OTP leaked.
 *
 * The action submits two operator-relayed txs in sequence:
 *   1. `cancelTrip(tripId)`  — flips the on-chain trip to cancelled
 *   2. `sweepUnspent(tripId)` — returns the entire unspent budget to
 *                                `t.buyer` (contract-enforced recipient)
 *
 * Why operator-relay vs buyer-passkey signing in v1:
 *   The contract permits BOTH paths — `cancelTrip` and `sweepUnspent`
 *   accept `t.buyer || operator`. Operator-relay is the v1 because:
 *     - Same submitter (apps/app/lib/operator-submit.ts) closes both
 *       this and the OTP setClaimCodeHash rotation in one piece of
 *       infra work.
 *     - No WebAuthn dependency on the dashboard — ships immediately.
 *     - Sweep recipient is contract-enforced as `t.buyer`, so operator
 *       relay can't redirect funds to anywhere else.
 *
 * The v2 enhancement is per-admin passkey signing on this page,
 * purely additive (no contract change).
 */

import { auth } from '@clerk/nextjs/server';
import { prisma } from '@sendero/database';

import { submitCancelTrip, submitSweepUnspent } from '@/lib/operator-submit';

export type CancelSweepResult =
  | {
      kind: 'executed';
      cancelledTxHash: `0x${string}`;
      sweptTxHash: `0x${string}`;
      /** Reserved for the future block-event observer to fill in. */
      recoveredMicroUsdc?: string;
    }
  | { kind: 'unauthorized'; reason: 'no_session' | 'wrong_tenant' | 'not_buyer' }
  | { kind: 'invalid_state'; reason: 'already_cancelled' | 'already_settled' | 'not_found' }
  | {
      /** Operator infra not configured (typically dev env). UI falls back to manual instructions. */
      kind: 'operator_unavailable';
      message: string;
      manualInstructions: string;
    }
  | { kind: 'failed'; step: 'cancel' | 'sweep'; reason: string };

export async function cancelTripAndSweep(tripId: string): Promise<CancelSweepResult> {
  // 1. Authenticate the caller.
  const { userId, orgId } = await auth();
  if (!userId) return { kind: 'unauthorized', reason: 'no_session' };
  if (!orgId) return { kind: 'unauthorized', reason: 'wrong_tenant' };

  const tenant = await prisma.tenant.findUnique({
    where: { clerkOrgId: orgId },
    select: { id: true },
  });
  if (!tenant) return { kind: 'unauthorized', reason: 'wrong_tenant' };

  // 2. Verify the trip belongs to this tenant.
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, tenantId: tenant.id },
    select: { id: true, status: true },
  });
  if (!trip) return { kind: 'unauthorized', reason: 'not_buyer' };

  // 3. Surface invalid-state branches before attempting any tx work.
  if (trip.status === 'canceled') {
    return { kind: 'invalid_state', reason: 'already_cancelled' };
  }
  if (trip.status === 'completed') {
    return { kind: 'invalid_state', reason: 'already_settled' };
  }

  // 4. Trip.id is the on-chain bytes32 hex (same id flows through
  //    prefund_trip → createTrip). Validate the shape so a malformed
  //    cuid never reaches the contract.
  if (!/^0x[0-9a-fA-F]{64}$/.test(tripId)) {
    return {
      kind: 'failed',
      step: 'cancel',
      reason: `tripId must be hex32; got ${tripId.length} chars`,
    };
  }
  const onchainTripId = tripId as `0x${string}`;

  // 5. Operator submits cancelTrip on the buyer's behalf.
  const cancelResult = await submitCancelTrip({ onchainTripId });
  if (!cancelResult.ok) {
    // Repo tsconfig has `strict: false`, which makes negation-narrowing
    // on discriminated unions unreliable — explicit cast keeps the rest
    // of the failure branch readable.
    const fail = cancelResult as Extract<typeof cancelResult, { ok: false }>;
    if (fail.reason === 'operator_key_unavailable' && !process.env.VERCEL_ENV) {
      return {
        kind: 'operator_unavailable',
        message:
          'OPERATOR_PRIVATE_KEY not configured — cancel + sweep are not available in this environment.',
        manualInstructions:
          'In dev: set OPERATOR_PRIVATE_KEY to the operator EOA private key. In prod: this should never fire — config-doctor catches missing operator env at deploy time.',
      };
    }
    return {
      kind: 'failed',
      step: 'cancel',
      reason: fail.errorName ?? `${fail.reason}:${fail.message}`,
    };
  }

  // 6. Operator sweeps the unspent budget. Sweep recipient is always
  //    `t.buyer` per contract — operator-relay can't redirect funds.
  const sweepResult = await submitSweepUnspent({ onchainTripId });
  if (!sweepResult.ok) {
    // Cancel succeeded but sweep failed — partial state. Surface to
    // the user so they can retry sweep alone (cancel is idempotent
    // beyond the first call; the contract returns TripIsCancelled
    // on a re-cancel which we'd map cleanly).
    const fail = sweepResult as Extract<typeof sweepResult, { ok: false }>;
    return {
      kind: 'failed',
      step: 'sweep',
      reason: fail.errorName ?? `${fail.reason}:${fail.message}`,
    };
  }

  return {
    kind: 'executed',
    cancelledTxHash: cancelResult.txHash,
    sweptTxHash: sweepResult.txHash,
  };
}
