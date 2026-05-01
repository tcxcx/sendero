import {
  dispatchBookingSettledV1,
  dispatchBookingSettledV2,
  dispatchClaimLockout,
} from './dispatch';
import { ponder } from 'ponder:registry';
import {
  agentAction,
  agentAggregate,
  booking,
  buyerAggregate,
  claimAttempt,
  claimCodeRotation,
  claimLockout,
  systemEvent,
  trip,
  tripEvent,
} from 'ponder:schema';

// ════════════════════════════════════════════════════════════════════
// Trip lifecycle
// ════════════════════════════════════════════════════════════════════

ponder.on('SenderoGuestEscrow:TripCreated', async ({ event, context }) => {
  const {
    tripId,
    buyer,
    claimPubKey20,
    budget,
    expiresAt,
    metadataHash,
    metadataCID,
    agentTokenId,
    claimCodeHash,
  } = event.args;

  await context.db.insert(trip).values({
    id: tripId,
    buyer,
    claimPubKey20,
    guestWallet: null,
    budget,
    reserved: 0n,
    spent: 0n,
    expiresAt: BigInt(expiresAt),
    metadataHash,
    metadataCID,
    agentTokenId,
    claimCodeHash,
    status: 'ACTIVE',
    swept: false,
    createdAt: event.block.timestamp,
    createdTx: event.transaction.hash,
  });

  // Buyer aggregate
  await context.db
    .insert(buyerAggregate)
    .values({
      id: buyer,
      tripsCreated: 1n,
      tripsActive: 1n,
      totalFunded: budget,
    })
    .onConflictDoUpdate(row => ({
      tripsCreated: row.tripsCreated + 1n,
      tripsActive: row.tripsActive + 1n,
      totalFunded: row.totalFunded + budget,
    }));

  // Agent aggregate
  await context.db
    .insert(agentAggregate)
    .values({ id: agentTokenId, tripsAssigned: 1n })
    .onConflictDoUpdate(row => ({ tripsAssigned: row.tripsAssigned + 1n }));

  await context.db.insert(tripEvent).values({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    tripId,
    kind: 'created',
    amount: budget,
    txHash: event.transaction.hash,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
  });
});

ponder.on('SenderoGuestEscrow:TripClaimed', async ({ event, context }) => {
  await context.db.update(trip, { id: event.args.tripId }).set({
    guestWallet: event.args.guestWallet,
    status: 'CLAIMED',
    claimedAt: event.block.timestamp,
  });
  await context.db.insert(tripEvent).values({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    tripId: event.args.tripId,
    kind: 'claimed',
    txHash: event.transaction.hash,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
  });
});

ponder.on('SenderoGuestEscrow:TripCancelled', async ({ event, context }) => {
  await context.db.update(trip, { id: event.args.tripId }).set({
    status: 'CANCELLED',
    cancelledAt: event.block.timestamp,
  });
  await context.db.insert(tripEvent).values({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    tripId: event.args.tripId,
    kind: 'cancelled',
    txHash: event.transaction.hash,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
  });
});

ponder.on('SenderoGuestEscrow:Swept', async ({ event, context }) => {
  const t = await context.db.find(trip, { id: event.args.tripId });
  if (!t) return;

  await context.db.update(trip, { id: event.args.tripId }).set({
    swept: true,
    status: 'SWEPT',
    sweptAt: event.block.timestamp,
    sweptAmount: event.args.returned,
  });

  await context.db.update(buyerAggregate, { id: t.buyer }).set(row => ({
    tripsActive: row.tripsActive - 1n,
    tripsCompleted: row.tripsCompleted + 1n,
    totalSwept: row.totalSwept + event.args.returned,
  }));

  await context.db.insert(tripEvent).values({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    tripId: event.args.tripId,
    kind: 'swept',
    amount: event.args.returned,
    txHash: event.transaction.hash,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
  });
});

// ════════════════════════════════════════════════════════════════════
// Booking lifecycle
// ════════════════════════════════════════════════════════════════════

ponder.on('SenderoGuestEscrow:BookingReserved', async ({ event, context }) => {
  const { tripId, bookingId, upperBound } = event.args;

  await context.db
    .update(trip, { id: tripId })
    .set(row => ({ reserved: row.reserved + upperBound }));

  await context.db.insert(booking).values({
    id: bookingId,
    tripId,
    amount: upperBound,
    actualAmount: 0n,
    fee: 0n,
    status: 'RESERVED',
    reservedAt: event.block.timestamp,
  });

  await context.db.insert(tripEvent).values({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    tripId: tripId,
    kind: 'booking.reserved',
    bookingId: bookingId,
    amount: upperBound,
    txHash: event.transaction.hash,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
  });
});

ponder.on('SenderoGuestEscrow:BookingCommitted', async ({ event, context }) => {
  const { bookingId, vendorAmount, fee, vendor, itineraryHash, itineraryCID, slackReleased } =
    event.args;

  const b = await context.db.find(booking, { id: bookingId });
  if (!b) return;

  const actual = vendorAmount + fee;

  if (slackReleased > 0n) {
    await context.db
      .update(trip, { id: b.tripId })
      .set(row => ({ reserved: row.reserved - slackReleased }));
  }

  await context.db.update(booking, { id: bookingId }).set({
    amount: actual,
    actualAmount: actual,
    fee,
    vendor,
    vendorAmount,
    itineraryHash,
    itineraryCID,
    status: 'COMMITTED',
    committedAt: event.block.timestamp,
  });

  await context.db.insert(tripEvent).values({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    tripId: b.tripId,
    kind: 'booking.committed',
    bookingId: bookingId,
    amount: actual,
    txHash: event.transaction.hash,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
  });
});

ponder.on('SenderoGuestEscrow:DuffelConfirmed', async ({ event, context }) => {
  const b = await context.db.find(booking, { id: event.args.bookingId });
  if (!b) return;

  await context.db.update(booking, { id: event.args.bookingId }).set({
    duffelOrderHash: event.args.duffelOrderHash,
    confirmedAt: event.block.timestamp,
  });

  await context.db.insert(tripEvent).values({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    tripId: b.tripId,
    kind: 'booking.confirmed',
    bookingId: event.args.bookingId,
    txHash: event.transaction.hash,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
  });
});

ponder.on('SenderoGuestEscrow:BookingSettled', async ({ event, context }) => {
  const b = await context.db.find(booking, { id: event.args.bookingId });
  if (!b) return;

  const total = event.args.vendorAmount + event.args.feeAmount;
  const t = await context.db.find(trip, { id: b.tripId });
  if (!t) return;

  await context.db.update(trip, { id: b.tripId }).set(row => ({
    reserved: row.reserved - total,
    spent: row.spent + total,
  }));

  await context.db.update(booking, { id: event.args.bookingId }).set({
    status: 'SETTLED',
    settledAt: event.block.timestamp,
    vendorAmount: event.args.vendorAmount,
  });

  await context.db
    .update(buyerAggregate, { id: t.buyer })
    .set(row => ({ totalSpent: row.totalSpent + total }));

  await context.db.update(agentAggregate, { id: t.agentTokenId }).set(row => ({
    bookingsSettled: row.bookingsSettled + 1n,
    totalFeeEarned: row.totalFeeEarned + event.args.feeAmount,
  }));

  await context.db.insert(tripEvent).values({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    tripId: b.tripId,
    kind: 'booking.settled',
    bookingId: event.args.bookingId,
    amount: total,
    txHash: event.transaction.hash,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
  });

  // Keep Sendero's app DB in sync for channel tools. The Ponder DB is
  // authoritative for on-chain history, but WhatsApp/Slack/web support
  // tools read the app DB settlement tables for tenant-isolated context.
  try {
    const outcome = await dispatchBookingSettledV1({
      bookingId: event.args.bookingId,
      vendor: event.args.vendor,
      vendorAmount: event.args.vendorAmount.toString(),
      feeAmount: event.args.feeAmount.toString(),
      txHash: event.transaction.hash,
      blockNumber: event.block.number.toString(),
    });
    if (!outcome.ok) {
      console.error(
        `[indexer] BookingSettled dispatch failed for ${event.args.bookingId}: ${outcome.error}`
      );
    }
  } catch (err) {
    console.error(`[indexer] BookingSettled dispatch threw for ${event.args.bookingId}:`, err);
  }
});

ponder.on('SenderoGuestEscrow:BookingRefunded', async ({ event, context }) => {
  const b = await context.db.find(booking, { id: event.args.bookingId });
  if (!b) return;

  await context.db
    .update(trip, { id: b.tripId })
    .set(row => ({ reserved: row.reserved - event.args.amount }));

  await context.db.update(booking, { id: event.args.bookingId }).set({
    status: 'REFUNDED',
    refundedAt: event.block.timestamp,
  });

  await context.db.insert(tripEvent).values({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    tripId: b.tripId,
    kind: 'booking.refunded',
    bookingId: event.args.bookingId,
    amount: event.args.amount,
    txHash: event.transaction.hash,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
  });
});

ponder.on('SenderoGuestEscrow:BookingReclaimed', async ({ event, context }) => {
  const b = await context.db.find(booking, { id: event.args.bookingId });
  if (!b) return;

  await context.db
    .update(trip, { id: b.tripId })
    .set(row => ({ reserved: row.reserved - event.args.amount }));

  await context.db.update(booking, { id: event.args.bookingId }).set({
    status: 'RECLAIMED',
    refundedAt: event.block.timestamp,
    reclaimedFromStatus: event.args.priorStatus,
  });

  await context.db.insert(tripEvent).values({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    tripId: b.tripId,
    kind: 'booking.reclaimed',
    bookingId: event.args.bookingId,
    amount: event.args.amount,
    txHash: event.transaction.hash,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
  });
});

// ════════════════════════════════════════════════════════════════════
// Agent action metering (x402)
// ════════════════════════════════════════════════════════════════════

ponder.on('SenderoGuestEscrow:AgentActionLogged', async ({ event, context }) => {
  await context.db.insert(agentAction).values({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    tripId: event.args.tripId,
    agentTokenId: event.args.agentTokenId,
    actionType: event.args.actionType,
    feeMicro: event.args.feeMicro,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
    txHash: event.transaction.hash,
  });

  await context.db
    .update(agentAggregate, { id: event.args.agentTokenId })
    .set(row => ({ actionCount: row.actionCount + 1n }));
});

// ════════════════════════════════════════════════════════════════════
// System events — admin + UUPS lifecycle
// ════════════════════════════════════════════════════════════════════

ponder.on('SenderoGuestEscrow:OperatorUpdated', async ({ event, context }) => {
  await context.db.insert(systemEvent).values({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    kind: 'operatorUpdated',
    actor: event.transaction.from,
    newAddress: event.args.newOperator,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
    txHash: event.transaction.hash,
  });
});

ponder.on('SenderoGuestEscrow:Paused', async ({ event, context }) => {
  await context.db.insert(systemEvent).values({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    kind: 'paused',
    actor: event.args.account,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
    txHash: event.transaction.hash,
  });
});

ponder.on('SenderoGuestEscrow:Unpaused', async ({ event, context }) => {
  await context.db.insert(systemEvent).values({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    kind: 'unpaused',
    actor: event.args.account,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
    txHash: event.transaction.hash,
  });
});

ponder.on('SenderoGuestEscrow:Upgraded', async ({ event, context }) => {
  await context.db.insert(systemEvent).values({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    kind: 'upgraded',
    actor: event.transaction.from,
    newAddress: event.args.implementation,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
    txHash: event.transaction.hash,
  });
});

// ════════════════════════════════════════════════════════════════════
// v3.0.0 — claim-code lockout pipeline
//
// `ClaimAttemptFailed` and `ClaimCodeRotated` are log-only for now —
// future analytics surfaces (rising-attempt trend dashboards, OTP-cache
// invalidation for the operator) read from these tables.
//
// `ClaimLockoutTriggered` is the load-bearing one. We:
//   1. Insert a deduped row keyed on `(tripId, lockedUntil)` so
//      reorgs / re-runs only fire one notification.
//   2. Fan out to the app's internal endpoint via fetch. The endpoint
//      owns the heavy lifting (viem read, Prisma tenant lookup, send
//      via Resend/Slack/WhatsApp, persist `SecurityAlert` row).
//   3. Update the row with the dispatch outcome so the
//      `/sql/claim_lockout?status=failed` audit query works.
//
// The 60-second SLA from the OTP design depends on this dispatch path
// being inline with the Ponder event loop. If you offload to a queue,
// re-measure end-to-end latency before deploying.
// ════════════════════════════════════════════════════════════════════

ponder.on('SenderoGuestEscrow:ClaimAttemptFailed', async ({ event, context }) => {
  await context.db.insert(claimAttempt).values({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    tripId: event.args.tripId,
    attemptCount: event.args.attemptCount,
    txHash: event.transaction.hash,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
  });

  await context.db.insert(tripEvent).values({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    tripId: event.args.tripId,
    kind: 'claim.attempt_failed',
    txHash: event.transaction.hash,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
  });
});

ponder.on('SenderoGuestEscrow:ClaimLockoutTriggered', async ({ event, context }) => {
  // Idempotent dedup — `(tripId, lockedUntil)` uniquely identifies the
  // lockout window. If the indexer reprocesses the same log we hit the
  // ON CONFLICT DO NOTHING branch and skip the dispatch entirely.
  const dedupId = `${event.args.tripId}-${event.args.lockedUntil.toString()}`;
  const inserted = await context.db
    .insert(claimLockout)
    .values({
      id: dedupId,
      tripId: event.args.tripId,
      lockedUntil: event.args.lockedUntil,
      txHash: event.transaction.hash,
      blockNumber: event.block.number,
      timestamp: event.block.timestamp,
      dispatchStatus: 'pending',
    })
    .onConflictDoNothing();

  await context.db.insert(tripEvent).values({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    tripId: event.args.tripId,
    kind: 'claim.lockout_triggered',
    txHash: event.transaction.hash,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
  });

  // `inserted` is undefined when the conflict path was hit. Skip the
  // dispatch in that case — the original processing already fanned out
  // (or marked the row failed for ops to retry by hand).
  if (!inserted) return;

  // Errors here MUST NOT propagate — the indexer would stall and
  // every subsequent event would also fail. The dispatch helper
  // converts thrown errors into a `{ ok: false, error }` shape.
  let outcome: Awaited<ReturnType<typeof dispatchClaimLockout>>;
  try {
    outcome = await dispatchClaimLockout({
      tripId: event.args.tripId,
      lockedUntil: event.args.lockedUntil.toString(),
      txHash: event.transaction.hash,
      blockNumber: event.block.number.toString(),
    });
  } catch (err) {
    outcome = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (outcome.ok) {
    await context.db.update(claimLockout, { id: dedupId }).set({
      dispatchStatus: 'dispatched',
      dispatchError: null,
      dispatchedAt: event.block.timestamp,
    });
  } else {
    await context.db.update(claimLockout, { id: dedupId }).set({
      dispatchStatus: 'failed',
      dispatchError: outcome.error,
      dispatchedAt: event.block.timestamp,
    });
    console.error(
      `[indexer] ClaimLockoutTriggered dispatch failed for ${event.args.tripId}: ${outcome.error}`
    );
  }
});

ponder.on('SenderoGuestEscrow:ClaimCodeRotated', async ({ event, context }) => {
  await context.db.insert(claimCodeRotation).values({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    tripId: event.args.tripId,
    oldCodeHash: event.args.oldCodeHash,
    newCodeHash: event.args.newCodeHash,
    txHash: event.transaction.hash,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
  });

  await context.db.insert(tripEvent).values({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    tripId: event.args.tripId,
    kind: 'claim.code_rotated',
    txHash: event.transaction.hash,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
  });
});

// ════════════════════════════════════════════════════════════════════
// v3.0.0 — three-recipient settlement events
//
// `BookingCommittedV2` mirrors the legacy `BookingCommitted` write
// path but also captures the agency leg. We DO NOT update legacy
// `tripEvent.amount` semantics — the kind is namespaced (`v2`) so
// downstream readers can opt in.
//
// `BookingSettledV2` triggers settlement persistence in
// `packages/billing/src/settlement.ts::persistSettlementFromV2Event`
// (Track B7 — owns that file). Until B7 lands the app endpoint stubs
// the call with a logged TODO; the indexer-side audit row is written
// either way.
// ════════════════════════════════════════════════════════════════════

ponder.on('SenderoGuestEscrow:BookingCommittedV2', async ({ event, context }) => {
  const {
    bookingId,
    vendorAmount,
    fee,
    agencyAmount,
    vendor,
    itineraryHash,
    itineraryCID,
    slackReleased,
  } = event.args;

  const b = await context.db.find(booking, { id: bookingId });
  if (!b) return;

  // Total commit shrinks the trip's reserved by `slackReleased` (same
  // semantics as v1) AND now includes the agency leg in the booking
  // total. Three-way split: vendor + fee (operator) + agency (tenant).
  const actual = vendorAmount + fee + agencyAmount;

  if (slackReleased > 0n) {
    await context.db
      .update(trip, { id: b.tripId })
      .set(row => ({ reserved: row.reserved - slackReleased }));
  }

  await context.db.update(booking, { id: bookingId }).set({
    amount: actual,
    actualAmount: actual,
    fee,
    vendor,
    vendorAmount,
    itineraryHash,
    itineraryCID,
    status: 'COMMITTED',
    committedAt: event.block.timestamp,
  });

  await context.db.insert(tripEvent).values({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    tripId: b.tripId,
    kind: 'booking.committed.v2',
    bookingId,
    amount: actual,
    txHash: event.transaction.hash,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
  });
});

ponder.on('SenderoGuestEscrow:BookingSettledV2', async ({ event, context }) => {
  const b = await context.db.find(booking, { id: event.args.bookingId });
  if (!b) return;

  // `vendorAmount + agencyAmount + feeAmount` is the total release.
  // Match the v1 handler's effect on trip.reserved/spent so dashboards
  // stay consistent regardless of which settle path the booking took.
  const total = event.args.vendorAmount + event.args.agencyAmount + event.args.feeAmount;
  const t = await context.db.find(trip, { id: b.tripId });
  if (!t) return;

  await context.db.update(trip, { id: b.tripId }).set(row => ({
    reserved: row.reserved - total,
    spent: row.spent + total,
  }));

  await context.db.update(booking, { id: event.args.bookingId }).set({
    status: 'SETTLED',
    settledAt: event.block.timestamp,
    vendorAmount: event.args.vendorAmount,
  });

  await context.db
    .update(buyerAggregate, { id: t.buyer })
    .set(row => ({ totalSpent: row.totalSpent + total }));

  await context.db.update(agentAggregate, { id: t.agentTokenId }).set(row => ({
    bookingsSettled: row.bookingsSettled + 1n,
    totalFeeEarned: row.totalFeeEarned + event.args.feeAmount,
  }));

  await context.db.insert(tripEvent).values({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    tripId: b.tripId,
    kind: 'booking.settled.v2',
    bookingId: event.args.bookingId,
    amount: total,
    txHash: event.transaction.hash,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
  });

  // Fire the off-chain settlement persister via the app's internal
  // endpoint. Failures are logged but DO NOT block the indexer — the
  // ponder-side audit row above is the source of truth.
  try {
    const outcome = await dispatchBookingSettledV2({
      bookingId: event.args.bookingId,
      vendor: event.args.vendor,
      vendorAmount: event.args.vendorAmount.toString(),
      agencyAddress: event.args.agencyAddress,
      agencyAmount: event.args.agencyAmount.toString(),
      feeAmount: event.args.feeAmount.toString(),
      txHash: event.transaction.hash,
      blockNumber: event.block.number.toString(),
    });
    if (!outcome.ok) {
      console.error(
        `[indexer] BookingSettledV2 dispatch failed for ${event.args.bookingId}: ${outcome.error}`
      );
    }
  } catch (err) {
    console.error(`[indexer] BookingSettledV2 dispatch threw for ${event.args.bookingId}:`, err);
  }
});
