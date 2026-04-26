/**
 * Tenant markup math + Zod schemas (Track B2 of the markup v1 ship).
 *
 * Pure functions, zero IO, zero DB. The booking tool composes these on
 * top of `pricing.ts` (which still owns the 50bps base on confirm_booking)
 * and `plans.ts` (which still owns `bookingTakeRateDiscountBps` per tier).
 *
 * Invariants — burned in here so reviewers don't have to re-derive:
 *
 *   1. All money is BigInt micro-USDC. 1 USDC = 1_000_000n. NEVER float.
 *   2. Multiply-then-divide uses round-half-up (Eng A4):
 *        (a * b + denom / 2) / denom
 *      so a 199-micro × 50bps stake rounds to 1, not 0. Truncation here
 *      would let high-volume agencies game the floor by slicing tiny
 *      bookings under 200 micros each.
 *   3. v1 only honors `policy.markup.strategy === 'static'`. The Zod
 *      schema accepts the v2 strategies (`agent_negotiated`,
 *      `yield_managed`) so policy rows can be authored ahead of the v2
 *      ship, but the runtime throws `MarkupStrategyNotSupportedV1` rather
 *      than silently falling back. Schema-honest deferral, not silent
 *      half-build.
 *   4. The breakdown is computed from a SNAPSHOT of the policy that was
 *      pinned at quote-draft time, NOT the live policy (Eng A3). Race
 *      protection lives in the caller — this file just consumes whatever
 *      snapshot it's given.
 *   5. Sendero's take-floor scales with the same `bookingTakeRateDiscountBps`
 *      formula that scales the bps (Eng A5): Free $0.500 / Basic $0.475 /
 *      Pro $0.450 / Enterprise $0.425. The plan-tier discount is therefore
 *      visible at every booking size, not just above the floor.
 *   6. In `senderoTakeBehavior === 'deduct_from_markup'`, when the take
 *      exceeds the markup the agency leg clamps to zero and we surface
 *      `absorbInsufficient: true` (Eng A6). The caller blocks confirm in
 *      that case; we never let books go negative silently.
 */

import { z } from 'zod';
import type { PlanTier } from './plans';
import { applyBpsDiscount, resolvePlan } from './plans';

// ─────────────────────────────────────────────────────────────────────────────
// Errors — typed so callers can switch on `instanceof` without string-matching
// ─────────────────────────────────────────────────────────────────────────────

/** v1 only honors `static`; thrown when the snapshot asks for a v2 strategy. */
export class MarkupStrategyNotSupportedV1 extends Error {
  readonly code = 'MARKUP_STRATEGY_NOT_SUPPORTED_V1' as const;
  constructor(strategy: string) {
    super(
      `Markup strategy "${strategy}" is a v2 feature; v1 only honors "static". ` +
        'Update the tenant pricing policy to use { strategy: "static", bps } for now.'
    );
    this.name = 'MarkupStrategyNotSupportedV1';
  }
}

/** Caller passed BOTH `overrideMarkupBps` AND `overrideMarkupMicroUsdc`. */
export class MarkupAmbiguousInputError extends Error {
  readonly code = 'MARKUP_AMBIGUOUS_INPUT' as const;
  constructor() {
    super(
      'Pass either overrideMarkupBps OR overrideMarkupMicroUsdc, not both. ' +
        'The two override modes are mutually exclusive — pick percentage or absolute.'
    );
    this.name = 'MarkupAmbiguousInputError';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Zod schemas — single source of truth for the markupConfig JSON shape
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Static markup — v1 strategy. `bps` is basis points of cost, capped at
 * 10_000 (100%). The UI separately warns above 25% and blocks above 100%
 * (Design fix #4) but the schema's job is structural sanity, not
 * business-policy. >100% would just be wrong arithmetic.
 */
export const StaticMarkupSchema = z.object({
  strategy: z.literal('static'),
  bps: z.number().int().min(0).max(10_000),
});

/**
 * Agent-negotiated markup — v2 strategy. Buyer-side AI agent negotiates a
 * spread between floor and ceiling at booking time. v1 runtime rejects
 * this with MarkupStrategyNotSupportedV1; the schema accepts it so policy
 * rows can be authored ahead of the v2 ship.
 */
export const AgentNegotiatedMarkupSchema = z.object({
  strategy: z.literal('agent_negotiated'),
  floorBps: z.number().int().min(0).max(10_000),
  ceilingBps: z.number().int().min(0).max(10_000),
});

/**
 * Yield-managed markup — v2 strategy. Sendero's engine sets the markup
 * based on demand and tenant gets the configured share of the lift over
 * their floor. v1 runtime rejects.
 */
export const YieldManagedMarkupSchema = z.object({
  strategy: z.literal('yield_managed'),
  floorBps: z.number().int().min(0).max(10_000),
  liftShareBps: z.number().int().min(0).max(10_000).optional(),
});

/** Discriminated union over `strategy`. Add v2 variants by extending here. */
export const PerKindMarkupSchema = z.discriminatedUnion('strategy', [
  StaticMarkupSchema,
  AgentNegotiatedMarkupSchema,
  YieldManagedMarkupSchema,
]);

/**
 * Top-level markupConfig — keyed by BookingKind. Activation requires every
 * kind the tenant intends to support; the Quote API rejects with
 * POLICY_PARTIAL_FOR_KIND when a kind is missing at confirm time.
 */
export const MarkupConfigSchema = z.record(
  z.enum(['flight', 'hotel', 'rail', 'car', 'other']),
  PerKindMarkupSchema
);

export type MarkupConfig = z.infer<typeof MarkupConfigSchema>;
export type PerKindMarkup = z.infer<typeof PerKindMarkupSchema>;
export type BookingKind = 'flight' | 'hotel' | 'rail' | 'car' | 'other';

/**
 * Snapshot stored on `Booking.metadata.policySnapshot` at quote-draft
 * time. The `confirm_booking` tool re-reads from THIS shape, never from
 * the live policy, so a tenant editing markup mid-quote does not retro-
 * price the open quote (Eng A3).
 *
 * BigInts are serialized as decimal strings because the snapshot lives
 * in JSON; callers parse back via `BigInt()`.
 */
export const BookingPolicySnapshotSchema = z.object({
  policyVersion: z.number().int(),
  kind: z.enum(['flight', 'hotel', 'rail', 'car', 'other']),
  markup: PerKindMarkupSchema,
  floorMicroUsdc: z.string(),
  ceilingMicroUsdc: z.string().nullable(),
  senderoTakeBehavior: z.enum(['add_to_customer', 'deduct_from_markup']),
});

export type BookingPolicySnapshot = z.infer<typeof BookingPolicySnapshotSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Round-half-up BigInt math
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Round-half-up multiply-divide for BigInt. Equivalent to
 * `Math.round(a * b / denom)` but with no precision loss — we add half
 * the denominator before integer division so 0.5+ ticks round up.
 *
 * `denom` MUST be positive. Behaviour for negative `denom` is undefined.
 *
 * Why round-half-up and not banker's rounding (round-half-even)? Banker's
 * is the right choice for financial reporting where systematic bias
 * matters; for per-call take computation, round-half-up matches the
 * intuition agents have when they sanity-check by hand. The bias is
 * negligible at micro-USDC scale.
 */
export function mulDivRoundHalfUp(a: bigint, b: bigint, denom: bigint): bigint {
  return (a * b + denom / 2n) / denom;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sendero take — base bps + tier-scaled floor (Eng A5)
// ─────────────────────────────────────────────────────────────────────────────

export interface SenderoTakeArgs {
  /** Customer subtotal = cost + markup, before take. */
  customerSubtotalMicroUsdc: bigint;
  /** Base take in bps. 50 today (Sendero's flat rate; see plans.ts). */
  takeBpsBase: number;
  /** Base floor in micro-USDC. 500_000n (= $0.50) today. */
  floorMicroUsdcBase: bigint;
  /** Plan tier — drives `bookingTakeRateDiscountBps` for both bps + floor. */
  plan: PlanTier;
}

export interface SenderoTakeResult {
  microUsdc: bigint;
  /** 'floor_applied' when the bps math fell below the tier-scaled floor. */
  capping: 'none' | 'floor_applied';
  /** Tier-discounted bps actually charged. */
  effectiveBps: number;
  /** Tier-scaled floor actually applied. */
  effectiveFloorMicroUsdc: bigint;
}

/**
 * Compute Sendero's take on a confirmed booking. Both bps AND floor scale
 * with the plan tier's `bookingTakeRateDiscountBps` so the discount is
 * visible at every booking size (Eng A5).
 *
 * Formula:
 *   effectiveBps   = takeBpsBase × (1 - bookingTakeRateDiscountBps / 10_000)
 *   effectiveFloor = floorMicroUsdcBase × (1 - bookingTakeRateDiscountBps / 10_000)
 *   raw            = customerSubtotal × effectiveBps / 10_000   (round-half-up)
 *   take           = max(raw, effectiveFloor)
 *
 * Result of:
 *   Free       — 50.0 bps, floor $0.500
 *   Basic      — 47.5 bps, floor $0.475 (5% discount)
 *   Pro        — 45.0 bps, floor $0.450 (10% discount)
 *   Enterprise — 42.5 bps, floor $0.425 (15% discount)
 */
export function senderoTakeMicro(args: SenderoTakeArgs): SenderoTakeResult {
  const plan = resolvePlan(args.plan);
  const discountBps = plan.bookingTakeRateDiscountBps;

  // Same discount math as plans.ts::planPriceFor for the bps; mirror it
  // for the floor so the tier discount is honored at the small end too.
  const effectiveBps = Math.max(
    0,
    args.takeBpsBase - Math.round((args.takeBpsBase * discountBps) / 10_000)
  );
  const effectiveFloorMicroUsdc = applyBpsDiscount(args.floorMicroUsdcBase, discountBps);

  const raw = mulDivRoundHalfUp(args.customerSubtotalMicroUsdc, BigInt(effectiveBps), 10_000n);

  if (raw < effectiveFloorMicroUsdc) {
    return {
      microUsdc: effectiveFloorMicroUsdc,
      capping: 'floor_applied',
      effectiveBps,
      effectiveFloorMicroUsdc,
    };
  }
  return {
    microUsdc: raw,
    capping: 'none',
    effectiveBps,
    effectiveFloorMicroUsdc,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Markup breakdown — the headline computation
// ─────────────────────────────────────────────────────────────────────────────

export interface MarkupArgs {
  costMicroUsdc: bigint;
  bookingKind: BookingKind;
  /** Snapshot pinned at quote-draft, NOT the live policy (Eng A3). */
  policy: BookingPolicySnapshot;
  /** Agent override — markup as a percentage of cost. Mutually exclusive with the absolute form. */
  overrideMarkupBps?: number;
  /** Agent override — markup as an absolute amount. Mutually exclusive with bps. */
  overrideMarkupMicroUsdc?: bigint;
  plan: PlanTier;
}

export interface MarkupBreakdown {
  costMicroUsdc: bigint;
  markupMicroUsdc: bigint;
  /** Null when the agent set markup as an absolute amount. */
  markupBps: number | null;
  customerSubtotalMicroUsdc: bigint;
  senderoTakeMicroUsdc: bigint;
  /** Customer-facing total. Differs from subtotal only in 'add_to_customer' mode. */
  customerTotalMicroUsdc: bigint;
  /** What the tenant treasury actually receives. Clamped to 0n in absorb mode. */
  tenantTakeMicroUsdc: bigint;
  /** True when absorb mode would have produced a negative agency leg (Eng A6). */
  absorbInsufficient: boolean;
  /** Reflects whether the Sendero-take floor kicked in. */
  capping: 'none' | 'floor_applied';
}

const TAKE_BPS_BASE = 50;
const FLOOR_MICRO_USDC_BASE = 500_000n; // $0.50

/**
 * Compute the full breakdown for a single booking. Idempotent and pure —
 * given the same args, returns the same numbers, no IO.
 *
 * Order of operations:
 *   1. Resolve markup amount: override (bps or absolute) → policy default.
 *   2. customerSubtotal = cost + markup.
 *   3. Sendero take = senderoTakeMicro(subtotal, plan).
 *   4. Apply senderoTakeBehavior:
 *        - 'add_to_customer'   → customer pays subtotal + take, tenant gets full markup.
 *        - 'deduct_from_markup' → customer pays subtotal, tenant gets max(0, markup - take).
 *
 * Throws:
 *   - MarkupStrategyNotSupportedV1 if snapshot has a v2 strategy.
 *   - MarkupAmbiguousInputError if both override modes are passed.
 */
export function computeMarkupBreakdown(args: MarkupArgs): MarkupBreakdown {
  if (args.overrideMarkupBps !== undefined && args.overrideMarkupMicroUsdc !== undefined) {
    throw new MarkupAmbiguousInputError();
  }

  // v1 only honors static markup. The Zod schema accepts the v2 variants
  // so policy rows can be authored ahead of the v2 ship; we trip a typed
  // error here rather than silently fall back.
  if (args.policy.markup.strategy !== 'static') {
    throw new MarkupStrategyNotSupportedV1(args.policy.markup.strategy);
  }

  let markupMicroUsdc: bigint;
  let markupBps: number | null;

  if (args.overrideMarkupMicroUsdc !== undefined) {
    markupMicroUsdc = args.overrideMarkupMicroUsdc;
    markupBps = null; // absolute override loses the bps form
  } else {
    const bps = args.overrideMarkupBps ?? args.policy.markup.bps;
    markupBps = bps;
    markupMicroUsdc = mulDivRoundHalfUp(args.costMicroUsdc, BigInt(bps), 10_000n);
  }

  const customerSubtotalMicroUsdc = args.costMicroUsdc + markupMicroUsdc;

  const take = senderoTakeMicro({
    customerSubtotalMicroUsdc,
    takeBpsBase: TAKE_BPS_BASE,
    floorMicroUsdcBase: FLOOR_MICRO_USDC_BASE,
    plan: args.plan,
  });

  let customerTotalMicroUsdc: bigint;
  let tenantTakeMicroUsdc: bigint;
  let absorbInsufficient = false;

  if (args.policy.senderoTakeBehavior === 'add_to_customer') {
    // Passthrough mode — customer covers the take as a service fee on
    // top of the subtotal. Tenant gets their full markup; no clamp.
    customerTotalMicroUsdc = customerSubtotalMicroUsdc + take.microUsdc;
    tenantTakeMicroUsdc = markupMicroUsdc;
  } else {
    // Absorb mode — Sendero take comes out of the tenant's markup.
    // Customer pays the subtotal verbatim. If the take exceeds the
    // markup, clamp the agency leg to zero and surface the flag so the
    // caller can block the confirm rather than corrupt the books (Eng A6).
    customerTotalMicroUsdc = customerSubtotalMicroUsdc;
    if (take.microUsdc > markupMicroUsdc) {
      tenantTakeMicroUsdc = 0n;
      absorbInsufficient = true;
    } else {
      tenantTakeMicroUsdc = markupMicroUsdc - take.microUsdc;
    }
  }

  return {
    costMicroUsdc: args.costMicroUsdc,
    markupMicroUsdc,
    markupBps,
    customerSubtotalMicroUsdc,
    senderoTakeMicroUsdc: take.microUsdc,
    customerTotalMicroUsdc,
    tenantTakeMicroUsdc,
    absorbInsufficient,
    capping: take.capping,
  };
}
