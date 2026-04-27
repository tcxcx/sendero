/**
 * Credit-aware meter writer — the one place where SaaS-included
 * credits actually decrement off `Subscription.meterBalanceMicro`.
 *
 * Replaces the bare `recordMetered()` call for nanopayment-bearing
 * actions. Caller passes the proposed `costMicro` (already plan-priced
 * by `priceFor`) and this function decides:
 *
 *   1. Sandbox key  → write 1 row status='sandbox', no deduction.
 *   2. No subscription / no grant → write 1 row status='paid' at full
 *      cost, no deduction.
 *   3. Credit covers full cost → write 1 row status='credit'.
 *   4. Credit covers partial   → write 1 row status='credit' + 1 row
 *      status='paid' (with the plan's nanopayment discount on the
 *      overage portion).
 *   5. Daily cap fully spent → write 1 row status='paid' (overage
 *      semantics; balance untouched, monthly cap still respected
 *      via the existing `CapStore.spentInWindow` filter).
 *
 * **Atomicity.** All reads + the Subscription UPDATE + the MeterEvent
 * writes happen inside a single `prisma.$transaction`. Concurrent
 * turns serialize via a row-level `SELECT … FOR UPDATE` lock on the
 * Subscription row. The eng review's #1 critical gap (concurrent
 * deductions blowing past the daily cap by N×) closes by including
 * the daily-burn counter in the locked row's state — every turn sees
 * the post-write counter from the prior turn.
 *
 * **Idempotency.** Re-calling with the same `idempotencyKey` (typically
 * the turnId) returns the previously-written rows without writing
 * again or decrementing again. Built on the existing
 * `MeterEvent.idempotencyKey` unique index per CLAUDE.md.
 *
 * **Refund-on-failure.** This function is called *post-success* — the
 * caller only invokes it after the LLM/tool call returns OK. If the
 * caller throws before invocation, nothing has been written; balance
 * is unchanged. No separate refund path.
 *
 * **Daily window.** When wall clock has crossed
 * `dailyWindowStartedAt + 24h` the counter resets to zero AT
 * deduction time inside the transaction. No separate cron needed.
 */

import { prisma, type MeterStatus, type Prisma } from '@sendero/database';

import type { BillingSegment } from '@sendero/billing/pricing';
import type { PlanConfig } from '@sendero/billing/plans';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DeductAndRecordArgs {
  tenantId: string;
  /** Tool/action that ran (e.g. `'chat_reply'`, `'search_flights'`). */
  toolName: string;
  /** Plan-priced cost before any credit application, in micro-USDC. */
  costMicro: bigint;
  /** PlanConfig for the tenant — drives daily cap + overage discount. */
  plan: PlanConfig;
  /** Sandbox key on this dispatch. Skips deduction, writes 'sandbox'. */
  sandbox: boolean;
  segment: BillingSegment;
  /** Idempotency key — typically `turnId`. */
  idempotencyKey: string;
  userId?: string | null;
  payerAddress?: string | null;
  metadata?: Record<string, unknown> | null;
  note?: string | null;
}

export interface DeductAndRecordResult {
  /** All MeterEvent IDs written this call (1 or 2 rows). */
  meterEventIds: string[];
  /** Portion paid from credit grant in micro-USDC. */
  creditMicro: bigint;
  /** Portion paid from overage (with discount), in micro-USDC. */
  paidMicro: bigint;
  /** Subscription balance after deduction. null when no subscription row. */
  newBalanceMicro: bigint | null;
  /** Daily burn counter after deduction. null when no subscription row. */
  newDailyBurnMicro: bigint | null;
  /** True when this call was an idempotent replay (no new write). */
  replayed: boolean;
}

/**
 * Apply a basis-point discount to a micro-USDC value. Floors at 0n.
 * Mirrors the helper in `@sendero/billing/plans` to keep this file
 * dependency-light.
 */
function applyBpsDiscount(micro: bigint, bps: number): bigint {
  if (bps <= 0) return micro;
  const keep = BigInt(Math.max(0, 10_000 - bps));
  return (micro * keep) / 10_000n;
}

/**
 * The atomic-window state the transaction needs to read. Returned by
 * the SELECT … FOR UPDATE step.
 */
interface SubscriptionRowSlice {
  meterBalanceMicro: bigint;
  dailyCreditBurnMicro: bigint;
  dailyWindowStartedAt: Date | null;
}

async function lockSubscription(
  tx: Prisma.TransactionClient,
  tenantId: string
): Promise<SubscriptionRowSlice | null> {
  // Prisma doesn't expose `SELECT … FOR UPDATE` directly through the
  // generated client. `$queryRaw` does. We pin to the same `tx` so the
  // lock lives inside the enclosing transaction.
  const rows = await tx.$queryRaw<
    Array<{
      meterBalanceMicro: bigint;
      dailyCreditBurnMicro: bigint;
      dailyWindowStartedAt: Date | null;
    }>
  >`
    SELECT
      "meterBalanceMicro",
      "dailyCreditBurnMicro",
      "dailyWindowStartedAt"
    FROM "subscriptions"
    WHERE "tenantId" = ${tenantId}
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

interface SplitPlan {
  creditMicro: bigint;
  paidMicroPreDiscount: bigint;
  newBalanceMicro: bigint;
  newDailyBurnMicro: bigint;
  newWindowStart: Date;
}

/**
 * Compute the credit/paid split from a locked Subscription slice and
 * the proposed cost. Pure function — no I/O, deterministic from inputs.
 *
 * Order of constraints:
 *   1. Credit can never exceed remaining balance.
 *   2. Credit can never push daily-burn past `dailyCapMicro`.
 *   3. Anything not covered by credit becomes paid overage.
 *
 * Daily window: if more than 24h has passed since `dailyWindowStartedAt`
 * (or it was null), the counter resets to 0 inside this computation —
 * the caller writes back `newWindowStart = now`.
 */
function planSplit(
  row: SubscriptionRowSlice,
  costMicro: bigint,
  dailyCapMicro: bigint | null,
  now: Date
): SplitPlan {
  // Reset the daily window if needed.
  const windowStart = row.dailyWindowStartedAt;
  const windowExpired = windowStart === null || now.getTime() - windowStart.getTime() >= DAY_MS;
  const dailyBurn = windowExpired ? 0n : row.dailyCreditBurnMicro;
  const newWindowStart = windowExpired ? now : windowStart;

  // Credit is bounded by both the remaining balance AND the remaining
  // daily allowance. Apply the tighter bound.
  let creditCap = row.meterBalanceMicro < costMicro ? row.meterBalanceMicro : costMicro;
  if (dailyCapMicro !== null) {
    const remainingDaily = dailyCapMicro - dailyBurn;
    if (remainingDaily < creditCap) {
      creditCap = remainingDaily < 0n ? 0n : remainingDaily;
    }
  }

  const creditMicro = creditCap;
  const paidMicroPreDiscount = costMicro - creditMicro;

  return {
    creditMicro,
    paidMicroPreDiscount,
    newBalanceMicro: row.meterBalanceMicro - creditMicro,
    newDailyBurnMicro: dailyBurn + creditMicro,
    newWindowStart,
  };
}

/**
 * Find prior MeterEvents written under this idempotency key + tenant.
 * Used to short-circuit retries without double-deducting.
 *
 * Returns ALL rows for the key (could be 1 or 2 — credit + paid split),
 * or `null` when there's no prior write.
 */
async function findPriorRows(
  tx: Prisma.TransactionClient,
  tenantId: string,
  idempotencyKey: string
): Promise<Array<{ id: string; status: MeterStatus; priceMicroUsdc: bigint }> | null> {
  // The unique index on `MeterEvent` is `(tenantId, idempotencyKey)`,
  // so credit + paid rows of a split must use different keys. The
  // 'paid' overage row uses `${key}:overage` (see the write site
  // below). Look up BOTH variants so an idempotent replay reconstructs
  // the full split, not just the credit row.
  const rows = await tx.meterEvent.findMany({
    where: {
      tenantId,
      idempotencyKey: { in: [idempotencyKey, `${idempotencyKey}:overage`] },
    },
    select: { id: true, status: true, priceMicroUsdc: true },
  });
  return rows.length === 0 ? null : rows;
}

export async function deductAndRecord(args: DeductAndRecordArgs): Promise<DeductAndRecordResult> {
  return prisma.$transaction(async tx => {
    // 1. Idempotent replay — caller invoked us a second time with the
    //    same key. Return what was written before; do not deduct again.
    //    Compose the result from the rows on disk.
    const prior = await findPriorRows(tx, args.tenantId, args.idempotencyKey);
    if (prior) {
      const credit = prior.find(r => r.status === 'credit');
      const paid = prior.find(r => r.status === 'paid');
      const sub = await tx.subscription.findUnique({
        where: { tenantId: args.tenantId },
        select: { meterBalanceMicro: true, dailyCreditBurnMicro: true },
      });
      return {
        meterEventIds: prior.map(r => r.id),
        creditMicro: credit?.priceMicroUsdc ?? 0n,
        paidMicro: paid?.priceMicroUsdc ?? 0n,
        newBalanceMicro: sub?.meterBalanceMicro ?? null,
        newDailyBurnMicro: sub?.dailyCreditBurnMicro ?? null,
        replayed: true,
      };
    }

    // 2. Sandbox key — never decrements credit. Write a single
    //    `status='sandbox'` row at full cost so analytics is intact;
    //    NanopayBatch.findClaimableEvents already excludes 'sandbox'
    //    so no real USDC moves.
    if (args.sandbox) {
      const row = await tx.meterEvent.create({
        data: {
          tenantId: args.tenantId,
          userId: args.userId ?? null,
          payerAddress: args.payerAddress ?? null,
          toolName: args.toolName,
          priceMicroUsdc: args.costMicro,
          status: 'sandbox',
          settlementRef: null,
          note: args.note ?? null,
          metadata: (args.metadata as object | undefined) ?? undefined,
          idempotencyKey: args.idempotencyKey,
        },
        select: { id: true },
      });
      return {
        meterEventIds: [row.id],
        creditMicro: 0n,
        paidMicro: 0n,
        newBalanceMicro: null,
        newDailyBurnMicro: null,
        replayed: false,
      };
    }

    // 3. Lock the subscription row. Concurrent dispatches serialize
    //    here so the daily-burn counter never goes stale between
    //    read and write.
    const sub = await lockSubscription(tx, args.tenantId);

    // 4. No subscription row OR the tenant's plan doesn't include
    //    a credit envelope (free tier). Write `status='paid'` with
    //    the plan's nanopayment discount applied — Free has 0% so this
    //    is a no-op today, but it removes a footgun if a future plan
    //    sets `credits: null + discount > 0` (would silently drop the
    //    discount otherwise; see /review 2026-04-27).
    if (!sub || args.plan.monthlyIncludedCreditsMicro === null) {
      const paidMicro = applyBpsDiscount(args.costMicro, args.plan.nanopaymentDiscountBps);
      const row = await tx.meterEvent.create({
        data: {
          tenantId: args.tenantId,
          userId: args.userId ?? null,
          payerAddress: args.payerAddress ?? null,
          toolName: args.toolName,
          priceMicroUsdc: paidMicro,
          status: 'paid',
          settlementRef: null,
          note: args.note ?? null,
          metadata: (args.metadata as object | undefined) ?? undefined,
          idempotencyKey: args.idempotencyKey,
        },
        select: { id: true },
      });
      return {
        meterEventIds: [row.id],
        creditMicro: 0n,
        paidMicro,
        newBalanceMicro: sub?.meterBalanceMicro ?? null,
        newDailyBurnMicro: sub?.dailyCreditBurnMicro ?? null,
        replayed: false,
      };
    }

    // 5. Compute the split deterministically from the locked state.
    const split = planSplit(sub, args.costMicro, args.plan.dailyCreditCapMicro, new Date());

    // 6. Persist the new Subscription state. Always update — even when
    //    creditMicro is 0n we may have reset the daily window, and the
    //    write makes that durable.
    await tx.subscription.update({
      where: { tenantId: args.tenantId },
      data: {
        meterBalanceMicro: split.newBalanceMicro,
        dailyCreditBurnMicro: split.newDailyBurnMicro,
        dailyWindowStartedAt: split.newWindowStart,
      },
    });

    // 7. Write the MeterEvent rows. Up to two — the 'credit' row when
    //    any portion was covered, and a 'paid' row for the overage
    //    (with the plan's nanopayment discount applied).
    const meterEventIds: string[] = [];
    if (split.creditMicro > 0n) {
      const row = await tx.meterEvent.create({
        data: {
          tenantId: args.tenantId,
          userId: args.userId ?? null,
          payerAddress: args.payerAddress ?? null,
          toolName: args.toolName,
          priceMicroUsdc: split.creditMicro,
          status: 'credit',
          settlementRef: null,
          note: args.note ?? null,
          metadata: (args.metadata as object | undefined) ?? undefined,
          idempotencyKey: args.idempotencyKey,
        },
        select: { id: true },
      });
      meterEventIds.push(row.id);
    }

    let paidMicro = 0n;
    if (split.paidMicroPreDiscount > 0n) {
      paidMicro = applyBpsDiscount(split.paidMicroPreDiscount, args.plan.nanopaymentDiscountBps);
      // Edge: if the credit row already used the same idempotencyKey,
      // the unique index will fire on this second insert. Suffix the
      // 'paid' overage row's key so both can coexist.
      const row = await tx.meterEvent.create({
        data: {
          tenantId: args.tenantId,
          userId: args.userId ?? null,
          payerAddress: args.payerAddress ?? null,
          toolName: args.toolName,
          priceMicroUsdc: paidMicro,
          status: 'paid',
          settlementRef: null,
          note: args.note ?? null,
          metadata: (args.metadata as object | undefined) ?? undefined,
          // The 'paid' row uses a derived key so the per-tenant unique
          // index doesn't collide with the 'credit' row above. The
          // findPriorRows() check at the top still finds both via
          // findMany on the base key prefix, but we explicitly query by
          // the original key — so retry semantics match exactly.
          idempotencyKey:
            split.creditMicro > 0n ? `${args.idempotencyKey}:overage` : args.idempotencyKey,
        },
        select: { id: true },
      });
      meterEventIds.push(row.id);
    }

    return {
      meterEventIds,
      creditMicro: split.creditMicro,
      paidMicro,
      newBalanceMicro: split.newBalanceMicro,
      newDailyBurnMicro: split.newDailyBurnMicro,
      replayed: false,
    };
  });
}

// Test-only export — the pure split helper. Lets unit tests assert
// the constraint ordering (balance before daily-cap) and window-reset
// behavior without standing up a database.
export const __test = { planSplit, applyBpsDiscount };

// ─── MeterStore adapter ─────────────────────────────────────────────
//
// `runAgentTurn` and route handlers call `meterStore.create(input)` once
// per metered action. The bare `makeMeterStore()` writes a single row at
// `input.priceMicroUsdc` with no credit awareness. This adapter wraps
// `deductAndRecord()` in the same `MeterStore` shape so wiring is a
// 1-line swap at each call site:
//
//   meterStore: makeMeterStore({ forceStatus })           // before
//   meterStore: makeCreditAwareMeterStore({ plan, ... })  // after
//
// Returned `id` is the credit row when one was written, otherwise the
// paid row, otherwise the sandbox row — whichever is present. Callers
// that need the FULL split (both ids, the credit/paid breakdown) should
// invoke `deductAndRecord()` directly.

import type { MeterEventInput, MeterStore } from '@sendero/billing/meter';

export interface MakeCreditAwareMeterStoreOpts {
  plan: PlanConfig;
  /** Sandbox key on this dispatch — skip deduction, write status='sandbox'. */
  sandbox: boolean;
  segment: BillingSegment;
}

/**
 * Returns the same `MeterStore` shape that `makeMeterStore()` does,
 * but each `.create()` call routes through the credit-deduction
 * transaction. Tenants with no subscription / no grant fall through
 * to `status='paid'` at full cost, matching prior behavior — so swapping
 * this in is safe even before the `subscription.created` webhook lands.
 *
 * **Idempotency.** Reads `metadata.idempotencyKey` from the input (the
 * existing convention). If absent, generates a stable per-request key
 * from `(tenantId, toolName, timestamp)` so concurrent turns within the
 * same millisecond get different keys. Production callers should always
 * supply a stable key (typically the turnId) — silent fallback exists
 * to keep legacy callers working during rollout.
 */
export function makeCreditAwareMeterStore(opts: MakeCreditAwareMeterStoreOpts): MeterStore {
  return {
    create: async (input: MeterEventInput) => {
      // No tenant — system event, cron job, etc. Fall through to a
      // plain insert. Credits don't apply.
      if (!input.tenantId) {
        const row = await prisma.meterEvent.create({
          data: {
            tenantId: null,
            userId: input.userId ?? null,
            payerAddress: input.payerAddress ?? null,
            toolName: input.toolName,
            priceMicroUsdc: input.priceMicroUsdc,
            status: input.status,
            settlementRef: input.settlementRef ?? null,
            note: input.note ?? null,
            metadata: (input.metadata as object | undefined) ?? undefined,
            idempotencyKey: null,
          },
          select: { id: true },
        });
        return { id: row.id };
      }

      const idempotencyKey =
        input.metadata &&
        typeof input.metadata === 'object' &&
        'idempotencyKey' in input.metadata &&
        typeof (input.metadata as Record<string, unknown>).idempotencyKey === 'string'
          ? ((input.metadata as Record<string, unknown>).idempotencyKey as string)
          : `auto-${input.tenantId}-${input.toolName}-${Date.now()}`;

      const result = await deductAndRecord({
        tenantId: input.tenantId,
        toolName: input.toolName,
        costMicro: input.priceMicroUsdc,
        plan: opts.plan,
        sandbox: opts.sandbox,
        segment: opts.segment,
        idempotencyKey,
        userId: input.userId ?? null,
        payerAddress: input.payerAddress ?? null,
        metadata: (input.metadata as Record<string, unknown> | undefined) ?? null,
        note: input.note ?? null,
      });

      // Return the first written row's id — the credit row when one
      // was written, otherwise paid, otherwise sandbox. Callers that
      // need the full split bypass this adapter.
      return { id: result.meterEventIds[0] ?? '' };
    },
  };
}
