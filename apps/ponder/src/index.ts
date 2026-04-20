import { ponder } from 'ponder:registry';
import {
  trip,
  booking,
  agentAction,
  tripEvent,
  buyerAggregate,
  agentAggregate,
  systemEvent,
} from 'ponder:schema';

// ════════════════════════════════════════════════════════════════════
// Trip lifecycle
// ════════════════════════════════════════════════════════════════════

ponder.on('SenderoGuestEscrow:TripCreated', async ({ event, context }) => {
  const { tripId, buyer, claimPubKey20, budget, expiresAt, metadataHash, metadataCID, agentTokenId, claimCodeHash } = event.args;

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
    .onConflictDoUpdate((row) => ({
      tripsCreated: row.tripsCreated + 1n,
      tripsActive: row.tripsActive + 1n,
      totalFunded: row.totalFunded + budget,
    }));

  // Agent aggregate
  await context.db
    .insert(agentAggregate)
    .values({ id: agentTokenId, tripsAssigned: 1n })
    .onConflictDoUpdate((row) => ({ tripsAssigned: row.tripsAssigned + 1n }));

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

  await context.db
    .update(buyerAggregate, { id: t.buyer })
    .set((row) => ({
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
    .set((row) => ({ reserved: row.reserved + upperBound }));

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
  const { bookingId, vendorAmount, fee, vendor, itineraryHash, itineraryCID, slackReleased } = event.args;

  const b = await context.db.find(booking, { id: bookingId });
  if (!b) return;

  const actual = vendorAmount + fee;

  if (slackReleased > 0n) {
    await context.db
      .update(trip, { id: b.tripId })
      .set((row) => ({ reserved: row.reserved - slackReleased }));
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

  await context.db
    .update(trip, { id: b.tripId })
    .set((row) => ({
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
    .set((row) => ({ totalSpent: row.totalSpent + total }));

  await context.db
    .update(agentAggregate, { id: t.agentTokenId })
    .set((row) => ({
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
});

ponder.on('SenderoGuestEscrow:BookingRefunded', async ({ event, context }) => {
  const b = await context.db.find(booking, { id: event.args.bookingId });
  if (!b) return;

  await context.db
    .update(trip, { id: b.tripId })
    .set((row) => ({ reserved: row.reserved - event.args.amount }));

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
    .set((row) => ({ reserved: row.reserved - event.args.amount }));

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
    .set((row) => ({ actionCount: row.actionCount + 1n }));
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
