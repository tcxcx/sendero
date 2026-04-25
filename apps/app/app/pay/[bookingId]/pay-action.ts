'use server';

/**
 * Magic-link pay server action.
 *
 * Re-verifies the BookingPayToken on every call (the page-render
 * verify is advisory — auth happens here), runs the canonical
 * `executeTransferSpend` so the policy chain + audit row + spend
 * leg match every other settle surface, then atomically marks the
 * token consumed on success. A failed attempt does NOT consume the
 * token — the traveler can retry within the TTL window.
 *
 * No Clerk session required. Tenant comes from the token row, never
 * from session/cookies, so a stolen token cannot escalate scope.
 */

import { revalidatePath } from 'next/cache';

import { prisma } from '@sendero/database';

import { verifyBookingPayToken } from '@/lib/pay-link/verify';
import { executeTransferSpend } from '@/lib/transfer-spend/execute';

const APP_KIT_CHAIN = 'Arc_Testnet';
const ARC_TESTNET_CHAIN_ID = 5042002;

export type PayLinkResult =
  | {
      kind: 'executed';
      attemptId: string;
      txHash: string | null;
      amount: string;
    }
  | { kind: 'pending'; attemptId: string; reason: string }
  | {
      kind: 'blocked';
      attemptId: string;
      reason: string;
      trace: Array<{ guard: string | null; allowed: boolean; reason: string | null }>;
    }
  | { kind: 'delegate_missing'; attemptId: string }
  | { kind: 'failed'; attemptId: string; message: string }
  | {
      kind: 'rejected';
      code:
        | 'invalid_token'
        | 'expired'
        | 'consumed'
        | 'wrong_booking'
        | 'booking_not_pending'
        | 'no_traveler'
        | 'no_traveler_wallet'
        | 'no_payee_address';
      message: string;
    };

interface BookingMetadata {
  supplierPayee?: string;
}

function readSupplierPayee(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const m = metadata as BookingMetadata;
  return typeof m.supplierPayee === 'string' && m.supplierPayee ? m.supplierPayee : null;
}

export async function payByLinkAction(args: {
  bookingId: string;
  token: string;
}): Promise<PayLinkResult> {
  const verified = await verifyBookingPayToken({ token: args.token, bookingId: args.bookingId });
  if (verified.kind === 'invalid') {
    return { kind: 'rejected', code: 'invalid_token', message: 'Token is invalid.' };
  }
  if (verified.kind === 'expired') {
    return { kind: 'rejected', code: 'expired', message: 'Pay link has expired.' };
  }
  if (verified.kind === 'consumed') {
    return { kind: 'rejected', code: 'consumed', message: 'Pay link has already been used.' };
  }
  if (verified.kind === 'wrong_booking') {
    return {
      kind: 'rejected',
      code: 'wrong_booking',
      message: 'Token does not match this booking.',
    };
  }

  const { tenant, booking, tokenId } = verified;

  if (booking.status !== 'pending') {
    return {
      kind: 'rejected',
      code: 'booking_not_pending',
      message: `Booking is ${booking.status}.`,
    };
  }
  if (!booking.trip.travelerId) {
    return {
      kind: 'rejected',
      code: 'no_traveler',
      message: 'Booking has no traveler.',
    };
  }

  const wallet = await prisma.wallet.findFirst({
    where: {
      userId: booking.trip.travelerId,
      provisioner: 'dcw',
      chainId: ARC_TESTNET_CHAIN_ID,
    },
    select: { id: true },
  });
  if (!wallet) {
    return {
      kind: 'rejected',
      code: 'no_traveler_wallet',
      message: 'No DCW wallet on Arc — your operator needs to fund you first.',
    };
  }

  const recipient = readSupplierPayee(booking.metadata) ?? booking.supplier?.arcAddress ?? null;
  if (!recipient) {
    return {
      kind: 'rejected',
      code: 'no_payee_address',
      message: 'Supplier payout address is not configured.',
    };
  }

  const amount = booking.totalUsd.toFixed(2);

  // Race-safe consume: claim the token BEFORE running the spend via a
  // conditional update. Two simultaneous taps (e.g. flaky mobile WA
  // tap, fast double-click) both pass `verifyBookingPayToken` because
  // it reads consumedAt then later updates it. Without a conditional
  // update here, both calls reach `kit.spend` and double-charge the
  // traveler. `updateMany` returning count=0 means another tap already
  // claimed the token; reject this one as `consumed` so the user sees
  // the friendly already-used state, not a duplicate spend.
  const claimed = await prisma.bookingPayToken.updateMany({
    where: { id: tokenId, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (claimed.count === 0) {
    return { kind: 'rejected', code: 'consumed', message: 'Pay link has already been used.' };
  }

  const result = await executeTransferSpend({
    tenantId: tenant.id,
    travelerId: booking.trip.travelerId,
    amount,
    recipient,
    destinationChain: APP_KIT_CHAIN,
    metadata: {
      bookingId: booking.id,
      tripId: booking.trip.id,
      source: 'pay_link',
      tokenId,
    },
  });

  if (result.kind === 'executed') {
    // Stamp the audit pointer post-spend. consumedAt was already set
    // by the race-safe claim above; this update only attaches the
    // attemptId so /dashboard surfaces can join token → attempt.
    await prisma.bookingPayToken.update({
      where: { id: tokenId },
      data: { attemptId: result.attemptId },
    });
  } else {
    // Spend didn't move money (blocked / pending / delegate_missing /
    // failed). Roll the consume back so the traveler can retry within
    // the TTL window; otherwise a transient policy hiccup strands them
    // with a now-dead link.
    await prisma.bookingPayToken
      .update({ where: { id: tokenId }, data: { consumedAt: null } })
      .catch(err => {
        console.warn('[pay-action] rollback of token consume failed', err);
      });
  }

  revalidatePath(`/pay/${args.bookingId}`);

  switch (result.kind) {
    case 'executed':
      return {
        kind: 'executed',
        attemptId: result.attemptId,
        txHash: result.txHash,
        amount,
      };
    case 'blocked':
      return {
        kind: 'blocked',
        attemptId: result.attemptId,
        reason: result.reason,
        trace: result.trace.map(t => ({ guard: t.guard, allowed: t.allowed, reason: t.reason })),
      };
    case 'pending':
      return { kind: 'pending', attemptId: result.attemptId, reason: result.reason };
    case 'delegate_missing':
      return { kind: 'delegate_missing', attemptId: result.attemptId };
    case 'failed':
      return { kind: 'failed', attemptId: result.attemptId, message: result.message };
  }
}
