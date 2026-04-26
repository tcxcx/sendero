/**
 * Track B7 — settlement event observer.
 *
 * When the on-chain `BookingSettledV2` event fires (or `BookingSettled`
 * for legacy V1 commits), an off-chain observer (Ponder, polling
 * worker, manual reconciliation script) feeds the decoded event args
 * into one of the `persistSettlement*` helpers below. The helper:
 *
 *   1. Resolves the off-chain `Booking` row via `externalId` (matches
 *      the hex32 escrow bookingId).
 *   2. If found, atomically writes (per Eng A9, single transaction):
 *        - 1 `Settlement` row with grossMicroUsdc, denormalized cost +
 *          tenant + Sendero takes, the on-chain txHash, chain, and
 *          status='confirmed' + confirmedAt.
 *        - N `SettlementLeg` rows (3 for V2 = supplier + agency + fee;
 *          2 for V1 = supplier + fee), all sharing the same `txHash`
 *          (atomic on-chain).
 *   3. If the booking is missing (orphaned event), writes a
 *      `SecurityAlert` with `kind='settlement_orphan'` so ops can
 *      triage. NEVER throws — observers run in tight loops and a thrown
 *      error here would stall the tail.
 *   4. Idempotency — re-applying the same event is a no-op. The
 *      schema doesn't carry a `(bookingId, chain)` unique constraint
 *      yet, so we look up by `Settlement.bookingId + chain + txHash`
 *      first and short-circuit.
 *
 * The DB layer is injected via `SettlementStore` so unit tests can
 * exercise the full flow without Prisma. Production wiring is a thin
 * adapter in `packages/billing/src/settlement.ts::prismaSettlementStore`.
 */

// ─────────────────────────────────────────────────────────────────────
// Event arg shapes — match the ABI in @sendero/guest::SENDERO_GUEST_ESCROW_ABI
// ─────────────────────────────────────────────────────────────────────

export interface BookingSettledV2EventArgs {
  bookingId: `0x${string}`;
  vendor: `0x${string}`;
  vendorAmount: bigint;
  agencyAddress: `0x${string}`;
  agencyAmount: bigint;
  feeAmount: bigint;
}

export interface BookingSettledV1EventArgs {
  bookingId: `0x${string}`;
  vendor: `0x${string}`;
  vendorAmount: bigint;
  feeAmount: bigint;
}

export type SettlementLegKind = 'supplier' | 'agency' | 'fee';

// ─────────────────────────────────────────────────────────────────────
// Store interface — Prisma adapter lives in apps/app or scripts.
// ─────────────────────────────────────────────────────────────────────

export interface SettlementBookingRow {
  id: string;
  tenantId: string;
  tripId: string;
  costMicroUsdc: bigint | null;
}

export interface ExistingSettlementRow {
  id: string;
}

export interface NewSettlementInput {
  tenantId: string;
  tripId: string | null;
  bookingId: string;
  grossMicroUsdc: bigint;
  costMicroUsdc: bigint | null;
  tenantTakeMicroUsdc: bigint | null;
  senderoTakeMicroUsdc: bigint;
  chain: string;
  txHash: `0x${string}`;
  blockNumber: bigint;
  status: 'confirmed';
  confirmedAt: Date;
  legs: Array<{
    kind: SettlementLegKind;
    toAddress: `0x${string}`;
    amountMicroUsdc: bigint;
    txHash: `0x${string}`;
    index: number;
  }>;
}

export interface SecurityAlertInput {
  tenantId: string | null;
  kind: 'settlement_orphan';
  severity: 'medium';
  payload: Record<string, unknown>;
}

export interface SettlementStore {
  /** Resolve the off-chain Booking row from a hex32 escrow bookingId. */
  findBookingByExternalId(externalId: `0x${string}`): Promise<SettlementBookingRow | null>;
  /**
   * Idempotency guard. Look up an existing Settlement that matches
   * `(bookingId, chain, txHash)` so we never write a duplicate.
   */
  findExistingSettlement(args: {
    bookingId: string;
    chain: string;
    txHash: `0x${string}`;
  }): Promise<ExistingSettlementRow | null>;
  /**
   * Atomic write — Settlement + SettlementLegs in one transaction. The
   * implementation MUST run inside `prisma.$transaction([...])` per Eng A9.
   */
  createSettlementWithLegs(input: NewSettlementInput): Promise<{ id: string; legCount: number }>;
  /** Orphan-event channel. Always succeeds — ops triage offline. */
  recordSecurityAlert(input: SecurityAlertInput): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────
// Result shape — both helpers normalize to this.
// ─────────────────────────────────────────────────────────────────────

export interface PersistSettlementResult {
  /** Settlement row id, or null when the booking was orphaned. */
  settlementId: string | null;
  /** Number of legs written. 0 on orphan or duplicate idempotent hit. */
  legCount: number;
  /** True when an existing settlement matched and we no-oped. */
  alreadyExisted?: boolean;
  /** True when the booking was missing and a SecurityAlert was logged. */
  orphan?: boolean;
}

// ─────────────────────────────────────────────────────────────────────
// V2 event — three legs (supplier + agency + fee).
//
// Skip the agency leg only when `agencyAmount === 0n`. The contract
// itself only emits `BookingSettledV2` when the V2 commit path was
// used; legacy V1 commits fall through to `BookingSettled`. So a zero
// agency amount on a V2 event means "tenant priced cost-plus this trip"
// and we still record the settlement, just without an agency leg.
// ─────────────────────────────────────────────────────────────────────

export async function persistSettlementFromV2Event(args: {
  store: SettlementStore;
  event: BookingSettledV2EventArgs;
  txHash: `0x${string}`;
  blockNumber: bigint;
  chain: string;
  /** Override clock for tests. Defaults to `new Date()`. */
  now?: Date;
}): Promise<PersistSettlementResult> {
  return persistSettlement({
    store: args.store,
    event: { ...args.event, kind: 'v2' },
    txHash: args.txHash,
    blockNumber: args.blockNumber,
    chain: args.chain,
    now: args.now ?? new Date(),
  });
}

export async function persistSettlementFromV1Event(args: {
  store: SettlementStore;
  event: BookingSettledV1EventArgs;
  txHash: `0x${string}`;
  blockNumber: bigint;
  chain: string;
  now?: Date;
}): Promise<PersistSettlementResult> {
  return persistSettlement({
    store: args.store,
    event: { ...args.event, kind: 'v1' },
    txHash: args.txHash,
    blockNumber: args.blockNumber,
    chain: args.chain,
    now: args.now ?? new Date(),
  });
}

// ─────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────

type UnifiedEvent =
  | (BookingSettledV2EventArgs & { kind: 'v2' })
  | (BookingSettledV1EventArgs & { kind: 'v1' });

async function persistSettlement(args: {
  store: SettlementStore;
  event: UnifiedEvent;
  txHash: `0x${string}`;
  blockNumber: bigint;
  chain: string;
  now: Date;
}): Promise<PersistSettlementResult> {
  const { store, event, txHash, blockNumber, chain, now } = args;
  const isV2 = event.kind === 'v2';
  const agencyAmount = isV2 ? event.agencyAmount : 0n;
  const agencyAddress = isV2 ? event.agencyAddress : null;

  let booking: SettlementBookingRow | null;
  try {
    booking = await store.findBookingByExternalId(event.bookingId);
  } catch (err) {
    // Lookup failures are observability events, not control flow. Log
    // and treat as orphan so the indexer doesn't stall.
    console.warn('[settlement] findBookingByExternalId threw — treating as orphan', err);
    booking = null;
  }

  if (!booking) {
    try {
      await store.recordSecurityAlert({
        tenantId: null,
        kind: 'settlement_orphan',
        severity: 'medium',
        payload: {
          eventVersion: event.kind,
          bookingId: event.bookingId,
          vendor: event.vendor,
          vendorAmount: event.vendorAmount.toString(),
          agencyAmount: agencyAmount.toString(),
          agencyAddress,
          feeAmount: event.feeAmount.toString(),
          txHash,
          blockNumber: blockNumber.toString(),
          chain,
        },
      });
    } catch (err) {
      // Even the alert path is best-effort. Indexer must keep moving.
      console.error('[settlement] recordSecurityAlert failed', err);
    }
    return { settlementId: null, legCount: 0, orphan: true };
  }

  // Idempotency — if we've already persisted this txHash for this
  // booking on this chain, return the existing row. Same shape as a
  // fresh write so callers can treat the result uniformly.
  const existing = await store.findExistingSettlement({
    bookingId: booking.id,
    chain,
    txHash,
  });
  if (existing) {
    return { settlementId: existing.id, legCount: 0, alreadyExisted: true };
  }

  const grossMicroUsdc = event.vendorAmount + agencyAmount + event.feeAmount;

  const legs: NewSettlementInput['legs'] = [
    {
      kind: 'supplier',
      toAddress: event.vendor,
      amountMicroUsdc: event.vendorAmount,
      txHash,
      index: 0,
    },
  ];
  if (isV2 && agencyAmount > 0n && agencyAddress) {
    legs.push({
      kind: 'agency',
      toAddress: agencyAddress,
      amountMicroUsdc: agencyAmount,
      txHash,
      index: 1,
    });
  }
  // Fee leg always last so the index reflects post-agency position.
  legs.push({
    kind: 'fee',
    toAddress: event.vendor, // operator address is not in the event;
    // the Ponder loader stamps the actual operator addr if it can
    // resolve it via env. For now we record the vendor address as a
    // placeholder; reconcile-from-events.ts can backfill once we have
    // the operator wallet stamped via env.
    amountMicroUsdc: event.feeAmount,
    txHash,
    index: legs.length,
  });

  const result = await store.createSettlementWithLegs({
    tenantId: booking.tenantId,
    tripId: booking.tripId,
    bookingId: booking.id,
    grossMicroUsdc,
    costMicroUsdc: booking.costMicroUsdc,
    tenantTakeMicroUsdc: agencyAmount > 0n ? agencyAmount : null,
    senderoTakeMicroUsdc: event.feeAmount,
    chain,
    txHash,
    blockNumber,
    status: 'confirmed',
    confirmedAt: now,
    legs,
  });

  return { settlementId: result.id, legCount: result.legCount };
}

// ─────────────────────────────────────────────────────────────────────
// Default Prisma-backed store. Lazy-imports `@sendero/database` so the
// package still typechecks in environments without DB env.
// ─────────────────────────────────────────────────────────────────────

export function prismaSettlementStore(): SettlementStore {
  return {
    async findBookingByExternalId(externalId) {
      const { prisma } = await import('@sendero/database');
      const row = await prisma.booking.findFirst({
        where: { externalId },
        select: {
          id: true,
          tenantId: true,
          tripId: true,
          costMicroUsdc: true,
        },
      });
      if (!row) return null;
      return {
        id: row.id,
        tenantId: row.tenantId,
        tripId: row.tripId,
        costMicroUsdc: row.costMicroUsdc != null ? BigInt(row.costMicroUsdc.toString()) : null,
      };
    },

    async findExistingSettlement({ bookingId, chain, txHash }) {
      const { prisma } = await import('@sendero/database');
      const row = await prisma.settlement.findFirst({
        where: {
          bookingId,
          chain,
          txHashes: { has: txHash },
        },
        select: { id: true },
      });
      return row;
    },

    async createSettlementWithLegs(input) {
      const { prisma } = await import('@sendero/database');
      // Single transaction per Eng A9 — Settlement + Legs land together
      // or not at all. `prisma.$transaction([...])` is interactive on
      // Postgres so the ordering matters: create Settlement first to
      // capture its id for the Leg foreign keys.
      const [settlement] = await prisma.$transaction([
        prisma.settlement.create({
          data: {
            tenantId: input.tenantId,
            tripId: input.tripId ?? undefined,
            bookingId: input.bookingId,
            grossMicroUsdc: input.grossMicroUsdc,
            costMicroUsdc: input.costMicroUsdc ?? undefined,
            tenantTakeMicroUsdc: input.tenantTakeMicroUsdc ?? undefined,
            senderoTakeMicroUsdc: input.senderoTakeMicroUsdc,
            chain: input.chain,
            status: input.status,
            txHashes: [input.txHash],
            confirmedAt: input.confirmedAt,
            legs: {
              create: input.legs.map(l => ({
                kind: l.kind,
                toAddress: l.toAddress,
                amountMicroUsdc: l.amountMicroUsdc,
                txHash: l.txHash,
                index: l.index,
              })),
            },
          },
          select: { id: true, legs: { select: { id: true } } },
        }),
      ]);
      return { id: settlement.id, legCount: settlement.legs.length };
    },

    async recordSecurityAlert(input) {
      const { prisma } = await import('@sendero/database');
      await prisma.securityAlert.create({
        data: {
          tenantId: input.tenantId ?? undefined,
          kind: input.kind,
          severity: input.severity,
          payload: input.payload as object,
        },
      });
    },
  };
}
