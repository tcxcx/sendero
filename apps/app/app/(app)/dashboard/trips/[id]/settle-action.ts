'use server';

/**
 * Operator "Settle this hold" server action.
 *
 * Wired from the trip detail page CTA and the MetaInbox approval slot.
 * Resolves the booking + trip + supplier payee and the traveler's DCW
 * wallet, then runs the canonical `executeTransferSpend` helper so the
 * policy chain + App Kit delegate spend leg + TransferAttempt audit row
 * all match the `/api/transfer/spend` route exactly.
 *
 * The action returns a discriminated union the client component shapes
 * into a toast + inline trace.  Booking.status stays 'pending' here —
 * the booking webhook reconciliation in Step 6 owns that transition.
 */

import { revalidatePath } from 'next/cache';

import { prisma } from '@sendero/database';

import { requireCurrentTenant } from '@/lib/tenant-context';
import { executeTransferSpend } from '@/lib/transfer-spend/execute';

const ARC_TESTNET_CHAIN_ID = 5042002;
const APP_KIT_CHAIN = 'Arc_Testnet';

export type SettleHoldResult =
  | {
      kind: 'executed';
      attemptId: string;
      txHash: string | null;
      amount: string;
      recipient: string;
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
        | 'booking_not_pending'
        | 'booking_not_found'
        | 'no_traveler'
        | 'no_traveler_wallet'
        | 'no_payee_address'
        | 'already_settled';
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

export async function settleHoldAction(args: {
  tripId: string;
  bookingId: string;
}): Promise<SettleHoldResult> {
  const { tenant } = await requireCurrentTenant();

  const booking = await prisma.booking.findFirst({
    where: { id: args.bookingId, tenantId: tenant.id, tripId: args.tripId },
    select: {
      id: true,
      status: true,
      totalUsd: true,
      metadata: true,
      trip: { select: { id: true, travelerId: true } },
      supplier: { select: { arcAddress: true, name: true } },
    },
  });

  if (!booking) {
    return {
      kind: 'rejected',
      code: 'booking_not_found',
      message: 'Booking not found in this tenant.',
    };
  }
  if (booking.status !== 'pending') {
    return {
      kind: 'rejected',
      code: 'booking_not_pending',
      message: `Booking is ${booking.status}, not pending.`,
    };
  }
  if (!booking.trip.travelerId) {
    return {
      kind: 'rejected',
      code: 'no_traveler',
      message: 'Trip has no traveler — cannot settle on their behalf.',
    };
  }

  // Idempotency. If we already have an executed (or in-flight passed)
  // attempt for this booking, refuse rather than double-charge.
  const prior = await prisma.transferAttempt.findFirst({
    where: {
      tenantId: tenant.id,
      travelerId: booking.trip.travelerId,
      status: { in: ['executed', 'passed', 'pending'] },
      metadata: { path: ['bookingId'], equals: booking.id },
    },
    select: { id: true, status: true, txHash: true },
  });
  if (prior) {
    return {
      kind: 'rejected',
      code: 'already_settled',
      message:
        prior.status === 'executed'
          ? `Already settled (tx ${prior.txHash ?? prior.id.slice(0, 8)}).`
          : `A settle attempt is already ${prior.status}.`,
    };
  }

  const wallet = await prisma.wallet.findFirst({
    where: {
      userId: booking.trip.travelerId,
      provisioner: 'dcw',
      chainId: ARC_TESTNET_CHAIN_ID,
    },
    select: { id: true, address: true },
  });
  if (!wallet) {
    return {
      kind: 'rejected',
      code: 'no_traveler_wallet',
      message:
        'Traveler has no DCW wallet on Arc yet. Wallets are provisioned at hold — re-run the booking flow or wait for the next hold.',
    };
  }

  const recipient = readSupplierPayee(booking.metadata) ?? booking.supplier?.arcAddress ?? null;
  if (!recipient) {
    return {
      kind: 'rejected',
      code: 'no_payee_address',
      message: `No on-chain payout address for ${booking.supplier?.name ?? 'this supplier'}. Set Supplier.arcAddress or booking.metadata.supplierPayee first.`,
    };
  }

  const amount = booking.totalUsd.toFixed(2);

  const result = await executeTransferSpend({
    tenantId: tenant.id,
    travelerId: booking.trip.travelerId,
    amount,
    recipient,
    destinationChain: APP_KIT_CHAIN,
    metadata: {
      bookingId: booking.id,
      tripId: args.tripId,
      source: 'operator_settle',
    },
  });

  revalidatePath(`/dashboard/trips/${args.tripId}`);
  revalidatePath(`/dashboard/inbox/${args.tripId}`);

  // Fire the bidirectional rate_counterparty workflow on a successful
  // settle. Fire-and-forget — the workflow has its own 72h SLA + WDK
  // checkpointing; if the start call fails, the operator can replay
  // from the dashboard. Throws are swallowed because the user-visible
  // settle outcome should not be poisoned by reputation infra hiccups.
  if (result.kind === 'executed') {
    triggerRateCounterparty(booking.id).catch(err => {
      console.warn('[settle-action] rate_counterparty trigger failed (non-fatal)', err);
    });
  }

  switch (result.kind) {
    case 'executed':
      return {
        kind: 'executed',
        attemptId: result.attemptId,
        txHash: result.txHash,
        amount,
        recipient,
      };
    case 'blocked':
      return {
        kind: 'blocked',
        attemptId: result.attemptId,
        reason: result.reason,
        trace: result.trace.map(t => ({
          guard: t.guard,
          allowed: t.allowed,
          reason: t.reason,
        })),
      };
    case 'pending':
      return { kind: 'pending', attemptId: result.attemptId, reason: result.reason };
    case 'delegate_missing':
      return { kind: 'delegate_missing', attemptId: result.attemptId };
    case 'failed':
      return { kind: 'failed', attemptId: result.attemptId, message: result.message };
  }
}

/**
 * Server-side fire-and-forget kick of the rate_counterparty workflow
 * via its own HTTP route. We hit the route (rather than calling
 * `start(rateCounterparty, …)` directly) so the workflow runtime
 * lives behind one boundary — easier to swap to a queue / replay
 * surface later.
 *
 * The route uses AGENT_DISPATCH_SECRET / CRON_SECRET; we forward
 * whichever is present. NEXT_PUBLIC_APP_URL must point at the same
 * deployment so localhost↔prod don't get confused.
 */
async function triggerRateCounterparty(bookingId: string): Promise<void> {
  const secret = process.env.AGENT_DISPATCH_SECRET ?? process.env.CRON_SECRET;
  if (!secret) {
    console.warn(
      '[settle-action] no AGENT_DISPATCH_SECRET / CRON_SECRET — skipping rate_counterparty trigger'
    );
    return;
  }
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3010';
  const url = `${base.replace(/\/$/, '')}/api/workflows/reputation/rate-counterparty`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({ bookingId }),
    // 5s ceiling — workflow start should be sub-second; anything
    // longer means a deeper problem worth surfacing.
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`rate_counterparty trigger ${res.status}: ${body.slice(0, 200)}`);
  }
}
