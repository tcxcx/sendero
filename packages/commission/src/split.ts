/**
 * Compute + persist + settle a commission fan-out.
 *
 * Flow:
 *   1. `computeSplit` takes a CommissionSchedule + gross and returns the
 *      exact micro-USDC amounts per leg. All arithmetic is integer —
 *      last-leg absorption handles rounding dust so Σlegs == gross.
 *   2. `recordSettlementIntent` writes a Settlement + SettlementLeg[]
 *      rows in `pending` status.
 *   3. `markSettled` transitions to `confirmed` with the on-chain tx
 *      hashes. Keeps settlement append-only: no rows are deleted.
 *
 * Actual on-chain execution is the caller's job — pass the intent into
 * the existing `settle_split` tool (@sendero/tools) or a direct x402
 * batched transfer (@sendero/nanopayments). This package stays
 * runtime-neutral.
 */

import type { CommissionSchedule } from './schedule';

export interface ComputedLeg {
  kind: 'supplier' | 'agency' | 'rail' | 'validator' | 'fee' | 'other';
  toAddress: string;
  /** Micro-USDC. */
  amountMicro: bigint;
  note?: string;
  index: number;
}

export interface ComputedSplit {
  grossMicro: bigint;
  supplier: ComputedLeg;
  fees: ComputedLeg[];
  /** Ordered list (supplier first, then fees) for on-chain fan-out. */
  ordered: ComputedLeg[];
}

export function computeSplit(schedule: CommissionSchedule, grossMicro: bigint): ComputedSplit {
  if (grossMicro <= 0n) {
    throw new Error('grossMicro must be positive');
  }

  const fees: ComputedLeg[] = schedule.legs.map((leg, idx) => ({
    kind: leg.kind,
    toAddress: leg.toAddress,
    amountMicro: (grossMicro * BigInt(leg.bps)) / 10_000n,
    note: leg.note,
    index: idx + 1, // supplier occupies index 0
  }));

  const feesSum = fees.reduce((acc, l) => acc + l.amountMicro, 0n);
  const supplierAmount = grossMicro - feesSum;
  if (supplierAmount <= 0n) {
    throw new Error('Commission legs consumed the entire gross — supplier net ≤ 0');
  }

  const supplier: ComputedLeg = {
    kind: 'supplier',
    toAddress: schedule.supplierAddress,
    amountMicro: supplierAmount,
    note: 'Supplier net',
    index: 0,
  };

  return {
    grossMicro,
    supplier,
    fees,
    ordered: [supplier, ...fees],
  };
}

// ─────────────────────────────────────────────────────────────────────
// Persistence adapters — storage-agnostic so consumer injects Prisma
// ─────────────────────────────────────────────────────────────────────

export interface SettlementStore {
  createIntent: (args: {
    tenantId: string;
    tripId?: string | null;
    bookingId?: string | null;
    grossMicroUsdc: bigint;
    chain: string;
    chainId?: number | null;
    legs: Array<{
      kind: ComputedLeg['kind'];
      toAddress: string;
      amountMicroUsdc: bigint;
      index: number;
      note?: string | null;
    }>;
  }) => Promise<{ id: string; legs: Array<{ id: string; index: number }> }>;

  markSettled: (args: {
    settlementId: string;
    txHashes: string[];
    legTxHashes?: Array<{ legId: string; txHash: string }>;
    confirmedAt?: Date;
  }) => Promise<void>;

  markFailed: (args: { settlementId: string; error: string }) => Promise<void>;
}

export interface RecordIntentArgs {
  store: SettlementStore;
  tenantId: string;
  tripId?: string | null;
  bookingId?: string | null;
  split: ComputedSplit;
  chain: string;
  chainId?: number | null;
}

export async function recordSettlementIntent(
  args: RecordIntentArgs
): Promise<{ settlementId: string; legIds: Array<{ legId: string; index: number }> }> {
  const { id, legs } = await args.store.createIntent({
    tenantId: args.tenantId,
    tripId: args.tripId ?? null,
    bookingId: args.bookingId ?? null,
    grossMicroUsdc: args.split.grossMicro,
    chain: args.chain,
    chainId: args.chainId ?? null,
    legs: args.split.ordered.map(l => ({
      kind: l.kind,
      toAddress: l.toAddress,
      amountMicroUsdc: l.amountMicro,
      index: l.index,
      note: l.note ?? null,
    })),
  });
  return {
    settlementId: id,
    legIds: legs.map(l => ({ legId: l.id, index: l.index })),
  };
}
