/**
 * Phase 5 P5.4 — Gateway transfer reconciliation.
 *
 * The Gateway transfer state machine is:
 *
 *   attesting → minting → confirmed
 *                       ↘ failed
 *
 * Happy path: `POST /v1/transfer` returns an attestation, we self-mint
 * (Solana) or Circle forwards the mint (EVM), `confirmedAt` stamps,
 * status flips to `confirmed`. Most rows never need reconciliation.
 *
 * Sad paths:
 *   1. EVM forwarding silently stalls (Circle's relayer falls behind,
 *      destination chain congestion, the forwarding node crashes).
 *   2. Self-mint succeeds on-chain but our local stamp lost (Vercel
 *      function timeout AFTER `gatewayMint` lands, before our DB write).
 *   3. Network blip between `POST /v1/transfer` returning 200 and our
 *      INSERT — the row exists in Circle but never in our table. Out of
 *      this module's scope (no `circleTransferId` to query).
 *
 * `hydrateTransferFromCircle` is the single source of truth: ask Circle
 * for the row, copy its status + tx hash + fees + error into ours.
 * Idempotent — running it on a confirmed row does nothing surprising.
 *
 * Stamps `lastReconciledAt` on EVERY call so the cron can scan oldest-
 * first without re-hammering rows it already touched this minute.
 *
 * The reaper for `GatewayDepositLog` lives here too — same mental
 * shape, different table. Pending sweeps that never confirmed within
 * `staleMinutes` get flipped to `failed` so the operator UI shows them
 * as stuck instead of perpetually optimistic.
 */

import { prisma } from '@sendero/database';

// ── Constants ─────────────────────────────────────────────────────────

const GATEWAY_API = 'https://gateway-api-testnet.circle.com/v1';

/** Hard upper bound on a single Circle round-trip. Cron / per-row routes
 *  share the same budget; longer than this and we'd rather give up and
 *  let the next cron tick try again. */
const CIRCLE_FETCH_TIMEOUT_MS = 8_000;

// ── Types ─────────────────────────────────────────────────────────────

export type TransferStatus = 'attesting' | 'minting' | 'confirmed' | 'failed';

export interface ReconcileResult {
  logId: string;
  circleTransferId: string;
  /** Status BEFORE reconciliation. */
  before: TransferStatus;
  /** Status AFTER reconciliation. May equal `before` (no-op). */
  after: TransferStatus;
  /** True when the reconcile actually changed at least one column. */
  changed: boolean;
  /** Set when Circle returned a non-2xx or the request itself failed. */
  error?: string;
}

/**
 * Subset of the Circle `GET /v1/transfer/{id}` response we actually use.
 * Circle's response is large and version-volatile; we widen `unknown`
 * elsewhere and pick out only what we persist.
 */
interface CircleTransferResponse {
  transferId?: string;
  status?: string;
  transactionHash?: string | null;
  destinationTransactionHash?: string | null;
  errorReason?: string | null;
  fees?: Array<{
    forwardingFee?: string;
    gasFee?: string;
    totalFee?: string;
  }>;
}

// ── Status mapping ────────────────────────────────────────────────────

/**
 * Map Circle's transfer status string to our internal enum. Circle has
 * used several strings over the API's lifetime ('pending', 'submitted',
 * 'attested', 'forwarded', 'completed', 'confirmed', 'failed'). We
 * collapse them to the four states our schema knows.
 *
 * Unknown strings keep the row in its current state (defensive — we'd
 * rather under-report than corrupt the row on an API change).
 */
function mapCircleStatus(circle: string | undefined, current: TransferStatus): TransferStatus {
  if (!circle) return current;
  const s = circle.toLowerCase();
  if (s === 'confirmed' || s === 'completed' || s === 'success' || s === 'forwarded') {
    return 'confirmed';
  }
  if (s === 'failed' || s === 'rejected' || s === 'cancelled' || s === 'canceled') {
    return 'failed';
  }
  if (s === 'pending' || s === 'submitted' || s === 'minting') {
    return 'minting';
  }
  if (s === 'attesting' || s === 'attested') {
    return 'attesting';
  }
  return current;
}

// ── Public API ────────────────────────────────────────────────────────

/**
 * Pull canonical state for a single transfer from Circle and copy it
 * into our `GatewayTransferLog` row. Idempotent. Always stamps
 * `lastReconciledAt` so the cron's oldest-first ordering works.
 *
 * Returns a result describing what changed. Errors during the Circle
 * fetch are caught and reported in `result.error` rather than thrown —
 * the cron processes batches, one bad row shouldn't kill the rest.
 */
export async function hydrateTransferFromCircle(
  logId: string,
  circleTransferId: string
): Promise<ReconcileResult> {
  const row = await prisma.gatewayTransferLog.findUnique({
    where: { id: logId },
    select: {
      id: true,
      status: true,
      mintTxHash: true,
      circleDestinationTxHash: true,
      errorMessage: true,
    },
  });

  if (!row) {
    return {
      logId,
      circleTransferId,
      before: 'attesting',
      after: 'attesting',
      changed: false,
      error: 'transfer-log row not found',
    };
  }

  const before = row.status as TransferStatus;
  const url = `${GATEWAY_API}/transfer/${encodeURIComponent(circleTransferId)}`;

  let circle: CircleTransferResponse;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(CIRCLE_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      // Always stamp lastReconciledAt so the cron rotates through rows
      // instead of getting stuck on a single 5xx loop.
      await prisma.gatewayTransferLog.update({
        where: { id: logId },
        data: { lastReconciledAt: new Date() },
      });
      return {
        logId,
        circleTransferId,
        before,
        after: before,
        changed: false,
        error: `circle ${res.status}: ${(await res.text()).slice(0, 200)}`,
      };
    }
    circle = (await res.json()) as CircleTransferResponse;
  } catch (err) {
    await prisma.gatewayTransferLog.update({
      where: { id: logId },
      data: { lastReconciledAt: new Date() },
    });
    return {
      logId,
      circleTransferId,
      before,
      after: before,
      changed: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const after = mapCircleStatus(circle.status, before);
  const updates: {
    status?: TransferStatus;
    confirmedAt?: Date;
    circleDestinationTxHash?: string;
    errorMessage?: string;
    lastReconciledAt: Date;
  } = { lastReconciledAt: new Date() };

  let changed = false;

  if (after !== before) {
    updates.status = after;
    changed = true;
    if (after === 'confirmed') {
      updates.confirmedAt = new Date();
    }
  }

  // Circle's `transactionHash` is the destination tx for forwarding
  // transfers. Only copy it when our row doesn't already have one —
  // Solana self-mint stamps `mintTxHash` ourselves and we shouldn't
  // overwrite that with whatever Circle reports.
  const destHash = circle.transactionHash ?? circle.destinationTransactionHash ?? null;
  if (destHash && !row.circleDestinationTxHash) {
    updates.circleDestinationTxHash = destHash;
    changed = true;
  }

  if (after === 'failed' && circle.errorReason && !row.errorMessage) {
    updates.errorMessage = circle.errorReason.slice(0, 500);
    changed = true;
  }

  await prisma.gatewayTransferLog.update({ where: { id: logId }, data: updates });

  return { logId, circleTransferId, before, after, changed };
}

// ── Stuck-transfer queries ────────────────────────────────────────────

export interface StuckTransferRow {
  id: string;
  circleTransferId: string;
  tenantId: string;
  status: TransferStatus;
  destinationDomain: number;
  createdAt: Date;
}

/**
 * Find transfers that have been in flight longer than `stuckMinutes`
 * and still have a `circleTransferId` we can poll. Sorted oldest first
 * so the cron drains the worst offenders before the newer ones — the
 * older a stuck transfer is, the more likely it's actually broken (vs
 * just slow).
 */
export async function findStuckTransfers(args: {
  stuckMinutes: number;
  limit: number;
}): Promise<StuckTransferRow[]> {
  const cutoff = new Date(Date.now() - args.stuckMinutes * 60_000);
  const rows = await prisma.gatewayTransferLog.findMany({
    where: {
      status: { in: ['attesting', 'minting'] },
      circleTransferId: { not: null },
      createdAt: { lt: cutoff },
    },
    orderBy: { createdAt: 'asc' },
    take: args.limit,
    select: {
      id: true,
      circleTransferId: true,
      tenantId: true,
      status: true,
      destinationDomain: true,
      createdAt: true,
    },
  });

  return rows.map(r => ({
    id: r.id,
    // Filter above guarantees non-null but Prisma can't prove it.
    circleTransferId: r.circleTransferId as string,
    tenantId: r.tenantId,
    status: r.status as TransferStatus,
    destinationDomain: r.destinationDomain,
    createdAt: r.createdAt,
  }));
}

// ── Stale-sweep reaper ────────────────────────────────────────────────

export interface ReaperResult {
  scanned: number;
  reaped: number;
  cutoff: Date;
}

/**
 * Flip `GatewayDepositLog` rows stuck in `pending` past `staleMinutes`
 * to `failed` with `errorMessage = 'reaped'`. Pending sweeps that
 * actually confirm get a webhook callback flip; rows still pending past
 * the timeout almost always mean Circle never picked the tx up
 * (orchestration bug, missing approval, balance shortfall, RPC drop)
 * and need operator attention.
 *
 * Idempotent: only flips rows currently `pending`. Re-running on an
 * already-`failed` row is a no-op.
 */
export async function reapStalePendingSweeps(args: {
  staleMinutes: number;
}): Promise<ReaperResult> {
  const cutoff = new Date(Date.now() - args.staleMinutes * 60_000);
  const candidates = await prisma.gatewayDepositLog.findMany({
    where: {
      status: 'pending',
      createdAt: { lt: cutoff },
    },
    select: { id: true },
  });

  if (candidates.length === 0) {
    return { scanned: 0, reaped: 0, cutoff };
  }

  const result = await prisma.gatewayDepositLog.updateMany({
    where: {
      id: { in: candidates.map(c => c.id) },
      status: 'pending',
    },
    data: {
      status: 'failed',
      errorMessage: 'reaped',
    },
  });

  return { scanned: candidates.length, reaped: result.count, cutoff };
}
