import {
  TripCreated,
  TripClaimed,
  TripCancelled,
  BookingReserved,
  BookingCommitted,
  DuffelConfirmed,
  BookingSettled,
  BookingRefunded,
  BookingReclaimed,
  Swept,
  AgentActionLogged,
} from '../generated/SenderoGuestEscrow/SenderoGuestEscrow';

import {
  Trip,
  Booking,
  AgentAction,
  TripEvent,
  BuyerAggregate,
  AgentAggregate,
} from '../generated/schema';

import { BigInt, Bytes, ethereum, log } from '@graphprotocol/graph-ts';

// ────────────────────────────────────────────────────────────────────
// Enum values must match schema.graphql. AssemblyScript doesn't export
// GraphQL enums, so we write them as string literals.
// ────────────────────────────────────────────────────────────────────

const TRIP_ACTIVE = 'ACTIVE';
const TRIP_CLAIMED = 'CLAIMED';
const TRIP_CANCELLED = 'CANCELLED';
const TRIP_SWEPT = 'SWEPT';

const BOOKING_RESERVED = 'RESERVED';
const BOOKING_COMMITTED = 'COMMITTED';
const BOOKING_SETTLED = 'SETTLED';
const BOOKING_REFUNDED = 'REFUNDED';
const BOOKING_RECLAIMED = 'RECLAIMED';

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

function eventId(event: ethereum.Event): string {
  return event.transaction.hash.toHexString() + '-' + event.logIndex.toString();
}

function loadTrip(tripId: Bytes): Trip | null {
  return Trip.load(tripId);
}

function getOrCreateBuyerAggregate(buyer: Bytes): BuyerAggregate {
  let agg = BuyerAggregate.load(buyer);
  if (agg == null) {
    agg = new BuyerAggregate(buyer);
    agg.tripsCreated = BigInt.zero();
    agg.tripsActive = BigInt.zero();
    agg.tripsCompleted = BigInt.zero();
    agg.totalFunded = BigInt.zero();
    agg.totalSpent = BigInt.zero();
    agg.totalSwept = BigInt.zero();
  }
  return agg;
}

function getOrCreateAgentAggregate(agentTokenId: BigInt): AgentAggregate {
  let agg = AgentAggregate.load(agentTokenId);
  if (agg == null) {
    agg = new AgentAggregate(agentTokenId);
    agg.tripsAssigned = BigInt.zero();
    agg.bookingsSettled = BigInt.zero();
    agg.totalFeeEarned = BigInt.zero();
    agg.actionCount = BigInt.zero();
  }
  return agg;
}

function writeTripEvent(
  tripId: Bytes,
  bookingId: Bytes | null,
  kind: string,
  amount: BigInt | null,
  event: ethereum.Event
): void {
  const te = new TripEvent(eventId(event));
  te.trip = tripId;
  te.kind = kind;
  if (bookingId !== null) te.booking = bookingId;
  if (amount !== null) te.amount = amount;
  te.txHash = event.transaction.hash;
  te.blockNumber = event.block.number;
  te.timestamp = event.block.timestamp;
  te.save();
}

// ────────────────────────────────────────────────────────────────────
// Trip lifecycle
// ────────────────────────────────────────────────────────────────────

export function handleTripCreated(event: TripCreated): void {
  const trip = new Trip(event.params.tripId);
  trip.buyer = event.params.buyer;
  trip.claimPubKey20 = event.params.claimPubKey20;
  trip.guestWallet = null;
  trip.budget = event.params.budget;
  trip.reserved = BigInt.zero();
  trip.spent = BigInt.zero();
  trip.expiresAt = BigInt.fromI32(event.params.expiresAt);
  trip.metadataHash = event.params.metadataHash;
  trip.metadataCID = event.params.metadataCID;
  trip.agentTokenId = event.params.agentTokenId;
  trip.status = TRIP_ACTIVE;
  trip.swept = false;
  trip.createdAt = event.block.timestamp;
  trip.createdTx = event.transaction.hash;
  trip.save();

  const buyerAgg = getOrCreateBuyerAggregate(event.params.buyer);
  buyerAgg.tripsCreated = buyerAgg.tripsCreated.plus(BigInt.fromI32(1));
  buyerAgg.tripsActive = buyerAgg.tripsActive.plus(BigInt.fromI32(1));
  buyerAgg.totalFunded = buyerAgg.totalFunded.plus(event.params.budget);
  buyerAgg.save();

  const agentAgg = getOrCreateAgentAggregate(event.params.agentTokenId);
  agentAgg.tripsAssigned = agentAgg.tripsAssigned.plus(BigInt.fromI32(1));
  agentAgg.save();

  writeTripEvent(event.params.tripId, null, 'created', event.params.budget, event);
}

export function handleTripClaimed(event: TripClaimed): void {
  const trip = loadTrip(event.params.tripId);
  if (trip == null) {
    log.warning('TripClaimed for unknown tripId {}', [event.params.tripId.toHexString()]);
    return;
  }
  trip.guestWallet = event.params.guestWallet;
  trip.status = TRIP_CLAIMED;
  trip.claimedAt = event.block.timestamp;
  trip.save();

  writeTripEvent(event.params.tripId, null, 'claimed', null, event);
}

export function handleTripCancelled(event: TripCancelled): void {
  const trip = loadTrip(event.params.tripId);
  if (trip == null) return;
  trip.status = TRIP_CANCELLED;
  trip.cancelledAt = event.block.timestamp;
  trip.save();

  writeTripEvent(event.params.tripId, null, 'cancelled', null, event);
}

export function handleSwept(event: Swept): void {
  const trip = loadTrip(event.params.tripId);
  if (trip == null) return;
  trip.swept = true;
  trip.status = TRIP_SWEPT;
  trip.sweptAt = event.block.timestamp;
  trip.sweptAmount = event.params.returned;
  trip.save();

  const buyerAgg = getOrCreateBuyerAggregate(trip.buyer);
  buyerAgg.tripsActive = buyerAgg.tripsActive.minus(BigInt.fromI32(1));
  buyerAgg.tripsCompleted = buyerAgg.tripsCompleted.plus(BigInt.fromI32(1));
  buyerAgg.totalSwept = buyerAgg.totalSwept.plus(event.params.returned);
  buyerAgg.save();

  writeTripEvent(event.params.tripId, null, 'swept', event.params.returned, event);
}

// ────────────────────────────────────────────────────────────────────
// Booking lifecycle
// ────────────────────────────────────────────────────────────────────

export function handleBookingReserved(event: BookingReserved): void {
  const trip = loadTrip(event.params.tripId);
  if (trip == null) return;

  trip.reserved = trip.reserved.plus(event.params.upperBound);
  trip.save();

  const booking = new Booking(event.params.bookingId);
  booking.trip = event.params.tripId;
  booking.amount = event.params.upperBound;
  booking.actualAmount = BigInt.zero();
  booking.fee = BigInt.zero();
  booking.status = BOOKING_RESERVED;
  booking.reservedAt = event.block.timestamp;
  booking.save();

  writeTripEvent(
    event.params.tripId,
    event.params.bookingId,
    'booking.reserved',
    event.params.upperBound,
    event
  );
}

export function handleBookingCommitted(event: BookingCommitted): void {
  const booking = Booking.load(event.params.bookingId);
  if (booking == null) return;
  const trip = loadTrip(booking.trip);
  if (trip == null) return;

  // Release slack from reserved (contract already did this on-chain)
  if (event.params.slackReleased.gt(BigInt.zero())) {
    trip.reserved = trip.reserved.minus(event.params.slackReleased);
    trip.save();
  }

  const actual = event.params.vendorAmount.plus(event.params.fee);
  booking.amount = actual;
  booking.actualAmount = actual;
  booking.fee = event.params.fee;
  booking.vendor = event.params.vendor;
  booking.itineraryHash = event.params.itineraryHash;
  booking.itineraryCID = event.params.itineraryCID;
  booking.vendorAmount = event.params.vendorAmount;
  booking.status = BOOKING_COMMITTED;
  booking.committedAt = event.block.timestamp;
  booking.save();

  writeTripEvent(booking.trip, event.params.bookingId, 'booking.committed', actual, event);
}

export function handleDuffelConfirmed(event: DuffelConfirmed): void {
  const booking = Booking.load(event.params.bookingId);
  if (booking == null) return;
  booking.duffelOrderHash = event.params.duffelOrderHash;
  booking.confirmedAt = event.block.timestamp;
  booking.save();

  writeTripEvent(booking.trip, event.params.bookingId, 'booking.confirmed', null, event);
}

export function handleBookingSettled(event: BookingSettled): void {
  const booking = Booking.load(event.params.bookingId);
  if (booking == null) return;
  const trip = loadTrip(booking.trip);
  if (trip == null) return;

  const total = event.params.vendorAmount.plus(event.params.feeAmount);
  trip.reserved = trip.reserved.minus(total);
  trip.spent = trip.spent.plus(total);
  trip.save();

  booking.status = BOOKING_SETTLED;
  booking.settledAt = event.block.timestamp;
  booking.vendorAmount = event.params.vendorAmount;
  booking.save();

  const buyerAgg = getOrCreateBuyerAggregate(trip.buyer);
  buyerAgg.totalSpent = buyerAgg.totalSpent.plus(total);
  buyerAgg.save();

  const agentAgg = getOrCreateAgentAggregate(trip.agentTokenId);
  agentAgg.bookingsSettled = agentAgg.bookingsSettled.plus(BigInt.fromI32(1));
  agentAgg.totalFeeEarned = agentAgg.totalFeeEarned.plus(event.params.feeAmount);
  agentAgg.save();

  writeTripEvent(booking.trip, event.params.bookingId, 'booking.settled', total, event);
}

export function handleBookingRefunded(event: BookingRefunded): void {
  const booking = Booking.load(event.params.bookingId);
  if (booking == null) return;
  const trip = loadTrip(booking.trip);
  if (trip == null) return;

  trip.reserved = trip.reserved.minus(event.params.amount);
  trip.save();

  booking.status = BOOKING_REFUNDED;
  booking.refundedAt = event.block.timestamp;
  booking.save();

  writeTripEvent(
    booking.trip,
    event.params.bookingId,
    'booking.refunded',
    event.params.amount,
    event
  );
}

export function handleBookingReclaimed(event: BookingReclaimed): void {
  const booking = Booking.load(event.params.bookingId);
  if (booking == null) return;
  const trip = loadTrip(booking.trip);
  if (trip == null) return;

  trip.reserved = trip.reserved.minus(event.params.amount);
  trip.save();

  booking.status = BOOKING_RECLAIMED;
  booking.refundedAt = event.block.timestamp;
  booking.reclaimedFromStatus = event.params.priorStatus;
  booking.save();

  writeTripEvent(
    booking.trip,
    event.params.bookingId,
    'booking.reclaimed',
    event.params.amount,
    event
  );
}

// ────────────────────────────────────────────────────────────────────
// Agent action metering (x402)
// ────────────────────────────────────────────────────────────────────

export function handleAgentActionLogged(event: AgentActionLogged): void {
  const action = new AgentAction(eventId(event));
  action.trip = event.params.tripId;
  action.agentTokenId = event.params.agentTokenId;
  action.actionType = event.params.actionType;
  action.feeMicro = event.params.feeMicro;
  action.blockNumber = event.block.number;
  action.timestamp = event.block.timestamp;
  action.txHash = event.transaction.hash;
  action.save();

  const agentAgg = getOrCreateAgentAggregate(event.params.agentTokenId);
  agentAgg.actionCount = agentAgg.actionCount.plus(BigInt.fromI32(1));
  agentAgg.save();
}
