import { onchainTable, index, relations } from 'ponder';

// ════════════════════════════════════════════════════════════════════
// Core entities — mirror the SenderoGuestEscrow on-chain state.
// Indexed as the chain produces events; postgres is the read layer.
// ════════════════════════════════════════════════════════════════════

export const trip = onchainTable(
  'trip',
  (t) => ({
    id:             t.hex().primaryKey(),       // tripId (bytes32)
    buyer:          t.hex().notNull(),
    claimPubKey20:  t.hex().notNull(),
    guestWallet:    t.hex(),                     // null until claimed
    budget:         t.bigint().notNull(),
    reserved:       t.bigint().notNull().default(0n),
    spent:          t.bigint().notNull().default(0n),
    expiresAt:      t.bigint().notNull(),
    metadataHash:   t.hex().notNull(),
    metadataCID:    t.text().notNull(),
    agentTokenId:   t.bigint().notNull(),
    claimCodeHash:  t.hex().notNull(),           // 0x00..00 = no 2FA
    status:         t.text().notNull(),          // 'ACTIVE'|'CLAIMED'|'CANCELLED'|'SWEPT'
    swept:          t.boolean().notNull().default(false),
    sweptAmount:    t.bigint(),
    createdAt:      t.bigint().notNull(),
    createdTx:      t.hex().notNull(),
    claimedAt:      t.bigint(),
    cancelledAt:    t.bigint(),
    sweptAt:        t.bigint(),
  }),
  (t) => ({
    byBuyer: index().on(t.buyer),
    byGuest: index().on(t.guestWallet),
    byStatus: index().on(t.status),
  }),
);

export const booking = onchainTable(
  'booking',
  (t) => ({
    id:               t.hex().primaryKey(),      // bookingId (bytes32)
    tripId:           t.hex().notNull(),
    amount:           t.bigint().notNull(),      // upper bound, shrinks to actual on commit
    actualAmount:     t.bigint().notNull().default(0n),
    fee:              t.bigint().notNull().default(0n),
    vendor:           t.hex(),
    vendorAmount:     t.bigint(),
    itineraryHash:    t.hex(),
    itineraryCID:     t.text(),
    duffelOrderHash:  t.hex(),
    status:           t.text().notNull(),        // 'RESERVED'|'COMMITTED'|'SETTLED'|'REFUNDED'|'RECLAIMED'
    reservedAt:       t.bigint().notNull(),
    committedAt:      t.bigint(),
    confirmedAt:      t.bigint(),
    settledAt:        t.bigint(),
    refundedAt:       t.bigint(),
    reclaimedFromStatus: t.integer(),
  }),
  (t) => ({
    byTrip: index().on(t.tripId),
    byStatus: index().on(t.status),
    byVendor: index().on(t.vendor),
  }),
);

// Per-block-per-log immutable records — append-only for audit.
export const agentAction = onchainTable(
  'agent_action',
  (t) => ({
    id:             t.text().primaryKey(),      // `${txHash}-${logIndex}`
    tripId:         t.hex().notNull(),
    agentTokenId:   t.bigint().notNull(),
    actionType:     t.integer().notNull(),
    feeMicro:       t.bigint().notNull(),
    blockNumber:    t.bigint().notNull(),
    timestamp:      t.bigint().notNull(),
    txHash:         t.hex().notNull(),
  }),
  (t) => ({
    byTrip: index().on(t.tripId),
    byAgent: index().on(t.agentTokenId),
  }),
);

export const tripEvent = onchainTable(
  'trip_event',
  (t) => ({
    id:           t.text().primaryKey(),        // `${txHash}-${logIndex}`
    tripId:       t.hex().notNull(),
    kind:         t.text().notNull(),
    bookingId:    t.hex(),
    amount:       t.bigint(),
    txHash:       t.hex().notNull(),
    blockNumber:  t.bigint().notNull(),
    timestamp:    t.bigint().notNull(),
  }),
  (t) => ({
    byTrip: index().on(t.tripId),
  }),
);

// ════════════════════════════════════════════════════════════════════
// Aggregate rollups (for admin dashboard / CFO views)
// ════════════════════════════════════════════════════════════════════

export const buyerAggregate = onchainTable('buyer_aggregate', (t) => ({
  id:              t.hex().primaryKey(),      // buyer address
  tripsCreated:    t.bigint().notNull().default(0n),
  tripsActive:     t.bigint().notNull().default(0n),
  tripsCompleted:  t.bigint().notNull().default(0n),
  totalFunded:     t.bigint().notNull().default(0n),
  totalSpent:      t.bigint().notNull().default(0n),
  totalSwept:      t.bigint().notNull().default(0n),
}));

export const agentAggregate = onchainTable('agent_aggregate', (t) => ({
  id:               t.bigint().primaryKey(),  // agentTokenId
  tripsAssigned:    t.bigint().notNull().default(0n),
  bookingsSettled:  t.bigint().notNull().default(0n),
  totalFeeEarned:   t.bigint().notNull().default(0n),
  actionCount:      t.bigint().notNull().default(0n),
}));

// ════════════════════════════════════════════════════════════════════
// System events — admin + UUPS lifecycle audit trail
// ════════════════════════════════════════════════════════════════════

export const systemEvent = onchainTable(
  'system_event',
  (t) => ({
    id:           t.text().primaryKey(),         // `${txHash}-${logIndex}`
    kind:         t.text().notNull(),            // 'operatorUpdated' | 'paused' | 'unpaused' | 'upgraded'
    actor:        t.hex(),                       // msg.sender where available
    newAddress:   t.hex(),                       // newOperator / implementation
    blockNumber:  t.bigint().notNull(),
    timestamp:    t.bigint().notNull(),
    txHash:       t.hex().notNull(),
  }),
  (t) => ({
    byKind: index().on(t.kind),
  }),
);

// Relations (for GraphQL field joins)
export const tripRelations = relations(trip, ({ many }) => ({
  bookings: many(booking),
  agentActions: many(agentAction),
  events: many(tripEvent),
}));

export const bookingRelations = relations(booking, ({ one }) => ({
  trip: one(trip, { fields: [booking.tripId], references: [trip.id] }),
}));

export const agentActionRelations = relations(agentAction, ({ one }) => ({
  trip: one(trip, { fields: [agentAction.tripId], references: [trip.id] }),
}));

export const tripEventRelations = relations(tripEvent, ({ one }) => ({
  trip: one(trip, { fields: [tripEvent.tripId], references: [trip.id] }),
}));
