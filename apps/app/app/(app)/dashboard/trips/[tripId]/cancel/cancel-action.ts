'use server';

/**
 * Server action contract for the buyer cancel-sweep dashboard page
 * (`/dashboard/trips/[tripId]/cancel?reason=lockout`).
 *
 * The legitimate buyer can land here in two ways:
 *   1. Click-through from a `claim_lockout` SecurityAlert email/Slack
 *      ping (the deep link the indexer-side `handleClaimLockoutTriggered`
 *      handler stamps into the alert payload).
 *   2. Manually navigate when they suspect the link / OTP leaked.
 *
 * The action submits two userOps in sequence on the buyer's MSCA:
 *   1. `cancelTrip(tripId)`  — flips the on-chain trip to cancelled
 *   2. `sweepUnspent(tripId)` — returns the entire unspent budget
 *
 * **TODO (msca-buyer-submitter)** — the buyer's MSCA submission helper
 * does not exist in the codebase yet. Other on-chain ops use the
 * operator MSCA via `@sendero/circle` Developer Wallet APIs, but the
 * buyer's MSCA is user-controlled (passkey / Modular Wallets SDK). The
 * canonical path is:
 *
 *   - server: encode the calldata, return an unsigned userOp
 *   - browser: passkey-sign via `@circle-fin/modular-wallets`
 *   - server: relay the signed userOp to the bundler, await receipt
 *
 * A "1-button server-only" path requires the operator to be authorized
 * to call `cancelTrip` on behalf of the buyer — which is NOT how the
 * contract works today (`cancelTrip` is `onlyBuyer`). The right
 * resolution is the passkey path above, gated by `useTransition` on
 * the client. Until that lands, this action returns
 * `{ kind: 'msca_submitter_pending' }` so the page can render a clear
 * "coming soon" state with the manual `cast send` instructions.
 */

import { auth } from '@clerk/nextjs/server';
import { prisma } from '@sendero/database';

export type CancelSweepResult =
  | {
      kind: 'executed';
      cancelledTxHash: `0x${string}`;
      sweptTxHash: `0x${string}`;
      recoveredMicroUsdc: string;
    }
  | { kind: 'unauthorized'; reason: 'no_session' | 'wrong_tenant' | 'not_buyer' }
  | { kind: 'invalid_state'; reason: 'already_cancelled' | 'already_settled' | 'not_found' }
  | {
      kind: 'msca_submitter_pending';
      message: string;
      manualInstructions: string;
    }
  | { kind: 'failed'; message: string };

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

  // 4. TODO(msca-buyer-submitter) — submit cancelTrip + sweepUnspent
  // userOps via the buyer's MSCA. See the file header for the full
  // contract. Until the submitter lands, return a clear status the
  // page can render and tell the user how to fall back manually.
  return {
    kind: 'msca_submitter_pending',
    message:
      'On-chain cancel + sweep needs the buyer-MSCA passkey submitter, which is not wired yet.',
    manualInstructions:
      'Until the submitter ships, an operator on the Sendero team can run `cast send <escrow> "cancelTrip(bytes32)" <tripId>` followed by `sweepUnspent(bytes32)` from the buyer EOA. Contact security@sendero.travel.',
  };
}
