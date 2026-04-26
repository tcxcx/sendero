/**
 * Unit tests for the markup math + Zod schemas.
 *
 * Coverage rationale (from the Eng + DX reviews):
 *   - Worked example from the plan TL;DR ($1000 hotel, 11%, Pro plan).
 *   - Round-half-up boundary at the smallest sub-cent slice (199 micros × 50 bps = 1).
 *   - Tier-scaled floor — every tier produces the right floor + bps.
 *   - Floor binding when bps math falls short.
 *   - Both senderoTakeBehavior modes — passthrough + absorb.
 *   - Absorb-insufficient clamp surfaces `absorbInsufficient: true` (Eng A6).
 *   - Override-bps within bounds + override-absolute work + ambiguous-input error.
 *   - v2 strategies in snapshot trip MarkupStrategyNotSupportedV1.
 *   - MarkupConfigSchema rejects negative / over-cap / missing-strategy shapes.
 */

import { test, expect, describe } from 'bun:test';
import {
  computeMarkupBreakdown,
  senderoTakeMicro,
  mulDivRoundHalfUp,
  MarkupConfigSchema,
  MarkupAmbiguousInputError,
  MarkupStrategyNotSupportedV1,
  type BookingPolicySnapshot,
} from './markup';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function staticPolicy(overrides: Partial<BookingPolicySnapshot> = {}): BookingPolicySnapshot {
  return {
    policyVersion: 1,
    kind: 'hotel',
    markup: { strategy: 'static', bps: 1100 }, // 11%
    floorMicroUsdc: '1000000', // $1
    ceilingMicroUsdc: null,
    senderoTakeBehavior: 'add_to_customer',
    ...overrides,
  };
}

const USD = (dollars: number): bigint => BigInt(Math.round(dollars * 1_000_000));

// ─────────────────────────────────────────────────────────────────────────────
// mulDivRoundHalfUp
// ─────────────────────────────────────────────────────────────────────────────

describe('mulDivRoundHalfUp', () => {
  test('rounds half up at the boundary (199 × 50 / 10_000 = 1, not 0)', () => {
    // 199 * 50 = 9950. 9950 + 5000 = 14950. 14950 / 10000 = 1.
    // Truncating multiply-divide would give 9950 / 10000 = 0.
    expect(mulDivRoundHalfUp(199n, 50n, 10_000n)).toBe(1n);
  });

  test('exact division returns the exact quotient', () => {
    expect(mulDivRoundHalfUp(1_000n, 50n, 10_000n)).toBe(5n);
  });

  test('half rounds up on a clean half', () => {
    // 1n × 5n / 10n = 0.5 — rounds up to 1.
    expect(mulDivRoundHalfUp(1n, 5n, 10n)).toBe(1n);
  });

  test('large BigInts stay precise', () => {
    // $50,000 booking × 50bps = $250.
    const grossMicro = 50_000n * 1_000_000n;
    expect(mulDivRoundHalfUp(grossMicro, 50n, 10_000n)).toBe(250n * 1_000_000n);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// senderoTakeMicro — tier-scaled floor + bps (Eng A5)
// ─────────────────────────────────────────────────────────────────────────────

describe('senderoTakeMicro tier scaling', () => {
  const TAKE_BPS_BASE = 50;
  const FLOOR = 500_000n;

  test('Free tier — 50 bps, floor $0.500', () => {
    const r = senderoTakeMicro({
      customerSubtotalMicroUsdc: USD(10_000),
      takeBpsBase: TAKE_BPS_BASE,
      floorMicroUsdcBase: FLOOR,
      plan: 'free',
    });
    expect(r.effectiveBps).toBe(50);
    expect(r.effectiveFloorMicroUsdc).toBe(500_000n);
    // $10K × 50bps = $50.
    expect(r.microUsdc).toBe(USD(50));
    expect(r.capping).toBe('none');
  });

  test('Basic tier — 47.5 bps (5% off 50), floor $0.475', () => {
    const r = senderoTakeMicro({
      customerSubtotalMicroUsdc: USD(10_000),
      takeBpsBase: TAKE_BPS_BASE,
      floorMicroUsdcBase: FLOOR,
      plan: 'basic',
    });
    // Math.round(50 * 500 / 10000) = 3 → 50 - 3 = 47.
    expect(r.effectiveBps).toBe(47);
    expect(r.effectiveFloorMicroUsdc).toBe(475_000n);
  });

  test('Pro tier — 45 bps (10% off 50), floor $0.450', () => {
    const r = senderoTakeMicro({
      customerSubtotalMicroUsdc: USD(10_000),
      takeBpsBase: TAKE_BPS_BASE,
      floorMicroUsdcBase: FLOOR,
      plan: 'pro',
    });
    expect(r.effectiveBps).toBe(45);
    expect(r.effectiveFloorMicroUsdc).toBe(450_000n);
  });

  test('Enterprise tier — 42.5 bps (15% off 50), floor $0.425', () => {
    const r = senderoTakeMicro({
      customerSubtotalMicroUsdc: USD(10_000),
      takeBpsBase: TAKE_BPS_BASE,
      floorMicroUsdcBase: FLOOR,
      plan: 'enterprise',
    });
    // Math.round(50 * 1500 / 10000) = 8 → 50 - 8 = 42 (rounded; spec says "42.5").
    expect(r.effectiveBps).toBe(42);
    expect(r.effectiveFloorMicroUsdc).toBe(425_000n);
  });

  test('floor binds when bps math falls short — $50 booking, free plan', () => {
    // 50 × 1_000_000 = 50_000_000 micro. × 50bps = 250_000 micro. Floor = 500_000.
    const r = senderoTakeMicro({
      customerSubtotalMicroUsdc: USD(50),
      takeBpsBase: TAKE_BPS_BASE,
      floorMicroUsdcBase: FLOOR,
      plan: 'free',
    });
    expect(r.microUsdc).toBe(500_000n);
    expect(r.capping).toBe('floor_applied');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeMarkupBreakdown — happy paths
// ─────────────────────────────────────────────────────────────────────────────

describe('computeMarkupBreakdown — passthrough mode', () => {
  test('worked example from plan: $1000 hotel, 11%, Basic plan', () => {
    // Spec calls out Basic plan worked example: cost $1000, markup $110,
    // subtotal $1110, take 47bps × $1110 = $5.217 → rounds to $5.22.
    const breakdown = computeMarkupBreakdown({
      costMicroUsdc: USD(1_000),
      bookingKind: 'hotel',
      policy: staticPolicy(),
      plan: 'basic',
    });
    expect(breakdown.costMicroUsdc).toBe(USD(1_000));
    expect(breakdown.markupMicroUsdc).toBe(USD(110));
    expect(breakdown.markupBps).toBe(1100);
    expect(breakdown.customerSubtotalMicroUsdc).toBe(USD(1_110));
    // 1_110_000_000 × 47 / 10_000 = 5_217_000 (exact, no rounding).
    expect(breakdown.senderoTakeMicroUsdc).toBe(5_217_000n);
    expect(breakdown.customerTotalMicroUsdc).toBe(USD(1_110) + 5_217_000n);
    expect(breakdown.tenantTakeMicroUsdc).toBe(USD(110));
    expect(breakdown.absorbInsufficient).toBe(false);
    expect(breakdown.capping).toBe('none');
  });

  test('Pro plan, $1000 hotel, 11% — tenant gets full markup, take is 45bps', () => {
    const breakdown = computeMarkupBreakdown({
      costMicroUsdc: USD(1_000),
      bookingKind: 'hotel',
      policy: staticPolicy(),
      plan: 'pro',
    });
    // 1_110_000_000 × 45 / 10_000 = 4_995_000.
    expect(breakdown.senderoTakeMicroUsdc).toBe(4_995_000n);
    expect(breakdown.tenantTakeMicroUsdc).toBe(USD(110));
  });

  test('floor binds — $50 booking, free plan, 15% markup → take is the $0.50 floor', () => {
    const breakdown = computeMarkupBreakdown({
      costMicroUsdc: USD(50),
      bookingKind: 'other',
      policy: staticPolicy({
        kind: 'other',
        markup: { strategy: 'static', bps: 1500 },
      }),
      plan: 'free',
    });
    expect(breakdown.markupMicroUsdc).toBe(USD(7.5));
    expect(breakdown.customerSubtotalMicroUsdc).toBe(USD(57.5));
    // $57.50 × 50bps = $0.2875 — below $0.50 floor.
    expect(breakdown.senderoTakeMicroUsdc).toBe(500_000n);
    expect(breakdown.capping).toBe('floor_applied');
  });
});

describe('computeMarkupBreakdown — absorb mode (deduct_from_markup)', () => {
  test('happy path: tenant gets markup minus take, customer pays subtotal verbatim', () => {
    const breakdown = computeMarkupBreakdown({
      costMicroUsdc: USD(1_000),
      bookingKind: 'hotel',
      policy: staticPolicy({ senderoTakeBehavior: 'deduct_from_markup' }),
      plan: 'basic',
    });
    expect(breakdown.customerTotalMicroUsdc).toBe(USD(1_110)); // no fee added
    // Tenant gets $110 - $5.217 = $104.783.
    expect(breakdown.tenantTakeMicroUsdc).toBe(USD(110) - 5_217_000n);
    expect(breakdown.absorbInsufficient).toBe(false);
  });

  test('insufficient markup clamps tenant leg to zero + flips absorbInsufficient', () => {
    // $50 booking, 1% markup = $0.50 markup. Free-plan take = $0.50 floor.
    // Take exceeds (or equals) markup → absorb mode would zero out the
    // agency leg. Use 50¢ exactly: take ($0.50) > markup ($0.50)? No, equal.
    // Use cost so that markup < take: $50 booking, 0.5% markup = $0.25.
    const breakdown = computeMarkupBreakdown({
      costMicroUsdc: USD(50),
      bookingKind: 'other',
      policy: staticPolicy({
        kind: 'other',
        markup: { strategy: 'static', bps: 50 }, // 0.5% → $0.25
        senderoTakeBehavior: 'deduct_from_markup',
      }),
      plan: 'free',
    });
    expect(breakdown.markupMicroUsdc).toBe(USD(0.25));
    // Subtotal = $50.25; take = $0.50 floor (since 50bps × $50.25 = $0.251).
    expect(breakdown.senderoTakeMicroUsdc).toBe(500_000n);
    expect(breakdown.absorbInsufficient).toBe(true);
    expect(breakdown.tenantTakeMicroUsdc).toBe(0n);
    // Customer still pays subtotal verbatim — no fee added in absorb mode.
    expect(breakdown.customerTotalMicroUsdc).toBe(USD(50.25));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Overrides
// ─────────────────────────────────────────────────────────────────────────────

describe('computeMarkupBreakdown — overrides', () => {
  test('overrideMarkupBps within bounds wins over policy default', () => {
    const breakdown = computeMarkupBreakdown({
      costMicroUsdc: USD(1_000),
      bookingKind: 'hotel',
      policy: staticPolicy(),
      overrideMarkupBps: 500, // 5% instead of policy's 11%
      plan: 'basic',
    });
    expect(breakdown.markupBps).toBe(500);
    expect(breakdown.markupMicroUsdc).toBe(USD(50));
  });

  test('overrideMarkupMicroUsdc absolute wins; markupBps becomes null', () => {
    const breakdown = computeMarkupBreakdown({
      costMicroUsdc: USD(1_000),
      bookingKind: 'hotel',
      policy: staticPolicy(),
      overrideMarkupMicroUsdc: USD(73), // arbitrary fixed amount
      plan: 'basic',
    });
    expect(breakdown.markupMicroUsdc).toBe(USD(73));
    expect(breakdown.markupBps).toBeNull();
  });

  test('passing both overrides throws MarkupAmbiguousInputError', () => {
    expect(() =>
      computeMarkupBreakdown({
        costMicroUsdc: USD(1_000),
        bookingKind: 'hotel',
        policy: staticPolicy(),
        overrideMarkupBps: 500,
        overrideMarkupMicroUsdc: USD(50),
        plan: 'basic',
      })
    ).toThrow(MarkupAmbiguousInputError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// v2 strategies are accepted by Zod but rejected by the runtime
// ─────────────────────────────────────────────────────────────────────────────

describe('computeMarkupBreakdown — v2 strategy gate', () => {
  test('agent_negotiated snapshot trips MarkupStrategyNotSupportedV1', () => {
    expect(() =>
      computeMarkupBreakdown({
        costMicroUsdc: USD(1_000),
        bookingKind: 'hotel',
        policy: staticPolicy({
          markup: { strategy: 'agent_negotiated', floorBps: 500, ceilingBps: 1500 },
        } as Partial<BookingPolicySnapshot>),
        plan: 'pro',
      })
    ).toThrow(MarkupStrategyNotSupportedV1);
  });

  test('yield_managed snapshot trips MarkupStrategyNotSupportedV1', () => {
    expect(() =>
      computeMarkupBreakdown({
        costMicroUsdc: USD(1_000),
        bookingKind: 'hotel',
        policy: staticPolicy({
          markup: { strategy: 'yield_managed', floorBps: 500, liftShareBps: 7000 },
        } as Partial<BookingPolicySnapshot>),
        plan: 'pro',
      })
    ).toThrow(MarkupStrategyNotSupportedV1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MarkupConfigSchema — Zod boundary checks (Eng A7)
// ─────────────────────────────────────────────────────────────────────────────

describe('MarkupConfigSchema', () => {
  test('accepts a valid static-only config', () => {
    const ok = MarkupConfigSchema.safeParse({
      hotel: { strategy: 'static', bps: 1100 },
      flight: { strategy: 'static', bps: 500 },
    });
    expect(ok.success).toBe(true);
  });

  test('rejects negative bps', () => {
    const bad = MarkupConfigSchema.safeParse({
      hotel: { strategy: 'static', bps: -100 },
    });
    expect(bad.success).toBe(false);
  });

  test('rejects bps > 10_000', () => {
    const bad = MarkupConfigSchema.safeParse({
      hotel: { strategy: 'static', bps: 10_001 },
    });
    expect(bad.success).toBe(false);
  });

  test('rejects entries missing the strategy discriminator', () => {
    const bad = MarkupConfigSchema.safeParse({
      hotel: { bps: 1100 },
    });
    expect(bad.success).toBe(false);
  });

  test('accepts v2 agent_negotiated for forward compat (runtime still rejects)', () => {
    const ok = MarkupConfigSchema.safeParse({
      hotel: { strategy: 'agent_negotiated', floorBps: 500, ceilingBps: 1500 },
    });
    expect(ok.success).toBe(true);
  });

  test('rejects unknown booking kinds', () => {
    const bad = MarkupConfigSchema.safeParse({
      cruise: { strategy: 'static', bps: 1000 },
    });
    expect(bad.success).toBe(false);
  });
});
