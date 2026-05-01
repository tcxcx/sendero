/**
 * Cross-runtime dispatch helpers used by the Ponder indexer to fire
 * off-chain side-effects (notifications, settlement persistence) when
 * an on-chain event lands.
 *
 * Why HTTP and not a direct call?
 *   - The notification senders (Resend / Slack / WhatsApp) live in
 *     `apps/app/lib`. Pulling them into `apps/ponder` would drag in
 *     Next.js, Clerk, and Prisma — a 3× bundle size for the indexer
 *     and a runtime that the indexer host (Railway) is not configured
 *     to support.
 *   - The app already has hardened auth + dedup on its API surface;
 *     we reuse it via a single internal POST endpoint guarded by
 *     `INDEXER_DISPATCH_SECRET`.
 *   - The indexer's own `claimLockout` table provides the upstream
 *     dedup key (`${tripId}-${lockedUntil}`), so re-processing the
 *     same log is a no-op even if the dispatch HTTP call retries.
 *
 * Failure model:
 *   - Network/HTTP failures are caught + logged. The caller decides
 *     whether to mark the row `failed` or `dispatched` based on the
 *     return value. A failing dispatch must NOT throw out of the
 *     handler — the indexer would stall.
 *   - A 60-second SLA is the design target (OTP design doc § "Buyer
 *     notification + fast cancel-sweep on lockout"). The fetch uses a
 *     short 10s timeout so a hung downstream doesn't bottleneck the
 *     indexer.
 */

const DEFAULT_TIMEOUT_MS = 10_000;

export type DispatchOutcome =
  | { ok: true; status: number }
  | { ok: false; status?: number; error: string };

interface DispatchOptions {
  /** Override timeout for tests. */
  timeoutMs?: number;
}

function appOrigin(): string {
  return process.env.SENDERO_APP_ORIGIN ?? process.env.APP_ORIGIN ?? 'https://app.sendero.travel';
}

function dispatchSecret(): string | null {
  return process.env.INDEXER_DISPATCH_SECRET ?? process.env.AGENT_DISPATCH_SECRET ?? null;
}

async function postJson(
  path: string,
  body: unknown,
  opts: DispatchOptions = {}
): Promise<DispatchOutcome> {
  const secret = dispatchSecret();
  if (!secret) {
    return {
      ok: false,
      error:
        'no_dispatch_secret: set INDEXER_DISPATCH_SECRET (or AGENT_DISPATCH_SECRET) on the indexer process',
    };
  }
  const url = `${appOrigin()}${path}`;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        ok: false,
        status: res.status,
        error: `non_2xx:${res.status}:${text.slice(0, 200)}`,
      };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(t);
  }
}

// ────────────────────────────────────────────────────────────────────
// Per-event dispatch helpers
// ────────────────────────────────────────────────────────────────────

export interface ClaimLockoutDispatchInput {
  tripId: `0x${string}`;
  lockedUntil: string; // bigint serialized as decimal string
  txHash: `0x${string}`;
  blockNumber: string; // bigint serialized as decimal string
}

/**
 * Fire `handleClaimLockoutTriggered` via the app's internal endpoint.
 * The endpoint is responsible for:
 *   - resolving the buyer via viem read of `escrow.trips(tripId)`
 *   - resolving the tenant via Prisma
 *   - fanning out across configured channels
 *   - persisting a `SecurityAlert` audit row in the app DB
 *
 * Returns a structured outcome so the indexer can mark its
 * `claimLockout` row as `dispatched` or `failed` accordingly.
 */
export async function dispatchClaimLockout(
  event: ClaimLockoutDispatchInput,
  opts?: DispatchOptions
): Promise<DispatchOutcome> {
  return postJson('/api/internal/security-alerts/claim-lockout', event, opts);
}

export interface BookingSettledV2DispatchInput {
  eventVersion?: 'v2';
  bookingId: `0x${string}`;
  vendor: `0x${string}`;
  vendorAmount: string;
  agencyAddress: `0x${string}`;
  agencyAmount: string;
  feeAmount: string;
  txHash: `0x${string}`;
  blockNumber: string;
}

/**
 * Persist the agency leg of a settlement so the off-chain billing
 * dashboard sees the three-way split.
 *
 * Track B7 owns `packages/billing/src/settlement.ts`. As of this
 * writing the file does not exist, so the app endpoint stubs the call
 * and we forward the raw event payload. When B7 lands, the endpoint
 * picks up `persistSettlementFromV2Event` automatically.
 */
export async function dispatchBookingSettledV2(
  event: BookingSettledV2DispatchInput,
  opts?: DispatchOptions
): Promise<DispatchOutcome> {
  return postJson('/api/internal/billing/settlement-v2', { eventVersion: 'v2', ...event }, opts);
}

export interface BookingSettledV1DispatchInput {
  eventVersion?: 'v1';
  bookingId: `0x${string}`;
  vendor: `0x${string}`;
  vendorAmount: string;
  feeAmount: string;
  txHash: `0x${string}`;
  blockNumber: string;
}

/**
 * Persist the legacy two-leg settlement path so channel tools that
 * read Sendero's app DB see the same escrow state as the live Ponder
 * indexer. Without this bridge, WhatsApp/Slack support can miss
 * settled bookings that only landed as `BookingSettled`.
 */
export async function dispatchBookingSettledV1(
  event: BookingSettledV1DispatchInput,
  opts?: DispatchOptions
): Promise<DispatchOutcome> {
  return postJson('/api/internal/billing/settlement-v2', { eventVersion: 'v1', ...event }, opts);
}
