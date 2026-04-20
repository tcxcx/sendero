/**
 * Nanopayment batch builder + settler.
 *
 * Runs as a scheduled job (Trigger.dev or cron). For each tenant with
 * unsettled paid MeterEvents, it:
 *   1. Opens a NanopayBatch in `pending`.
 *   2. Moves events into the batch window (writes batch id onto each
 *      MeterEvent.settlementRef so they're excluded from subsequent
 *      windows — the consuming adapter owns this via `claimEvents`).
 *   3. Transitions the batch to `settling`, fires the on-chain transfer
 *      via the injected settler.
 *   4. On success, marks `settled` and writes tx hash; on failure,
 *      `failed` with the error string so operators can retry.
 *
 * The actual on-chain primitive is @sendero/nanopayments (Circle
 * x402 batching), injected via `SettleFn`. This keeps the billing
 * package runtime-agnostic.
 */

import type { NanopayBatchStatus } from '@sendero/database';

export interface BatchStore {
  findClaimableEvents: (args: {
    tenantId: string;
    windowEndedAt: Date;
    limit: number;
  }) => Promise<Array<{ id: string; priceMicroUsdc: bigint }>>;

  openBatch: (args: {
    tenantId: string;
    totalMicroUsdc: bigint;
    eventCount: number;
    windowStartedAt: Date;
    windowEndedAt: Date;
  }) => Promise<{ id: string }>;

  claimEventsForBatch: (args: { batchId: string; eventIds: string[] }) => Promise<void>;

  updateBatchStatus: (args: {
    batchId: string;
    status: NanopayBatchStatus;
    txHash?: string | null;
    error?: string | null;
    settledAt?: Date | null;
  }) => Promise<void>;
}

export type SettleFn = (args: {
  batchId: string;
  tenantId: string;
  totalMicroUsdc: bigint;
}) => Promise<{ txHash: string }>;

export interface BuildAndSettleArgs {
  tenantId: string;
  /** Inclusive start; defaults to start-of-day UTC. */
  windowStartedAt?: Date;
  /** Exclusive end; defaults to now. */
  windowEndedAt?: Date;
  /** Event batch size — x402 batching has an upper bound, default 256. */
  maxEventsPerBatch?: number;
}

const DEFAULT_MAX = 256;

export async function buildAndSettleBatch(
  store: BatchStore,
  settle: SettleFn,
  args: BuildAndSettleArgs
): Promise<
  | {
      batchId: string;
      status: 'settled';
      txHash: string;
      totalMicroUsdc: bigint;
      eventCount: number;
    }
  | { batchId: string; status: 'failed'; error: string; totalMicroUsdc: bigint; eventCount: number }
  | { status: 'empty' }
> {
  const windowEndedAt = args.windowEndedAt ?? new Date();
  const windowStartedAt =
    args.windowStartedAt ??
    (() => {
      const d = new Date(windowEndedAt);
      d.setUTCHours(0, 0, 0, 0);
      return d;
    })();
  const maxEvents = args.maxEventsPerBatch ?? DEFAULT_MAX;

  const events = await store.findClaimableEvents({
    tenantId: args.tenantId,
    windowEndedAt,
    limit: maxEvents,
  });
  if (events.length === 0) return { status: 'empty' };

  const totalMicroUsdc = events.reduce((acc, e) => acc + e.priceMicroUsdc, 0n);

  const batch = await store.openBatch({
    tenantId: args.tenantId,
    totalMicroUsdc,
    eventCount: events.length,
    windowStartedAt,
    windowEndedAt,
  });

  await store.claimEventsForBatch({
    batchId: batch.id,
    eventIds: events.map(e => e.id),
  });

  try {
    await store.updateBatchStatus({ batchId: batch.id, status: 'settling' });
    const { txHash } = await settle({
      batchId: batch.id,
      tenantId: args.tenantId,
      totalMicroUsdc,
    });
    await store.updateBatchStatus({
      batchId: batch.id,
      status: 'settled',
      txHash,
      settledAt: new Date(),
    });
    return {
      batchId: batch.id,
      status: 'settled',
      txHash,
      totalMicroUsdc,
      eventCount: events.length,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await store.updateBatchStatus({ batchId: batch.id, status: 'failed', error: msg });
    return {
      batchId: batch.id,
      status: 'failed',
      error: msg,
      totalMicroUsdc,
      eventCount: events.length,
    };
  }
}
