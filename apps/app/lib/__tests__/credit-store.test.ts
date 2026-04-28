/**
 * Unit tests for the pure split-math helper inside `credit-store.ts`.
 *
 * The transaction wrapper (`deductAndRecord`) needs a real Prisma
 * client + a real Postgres database to exercise concurrency, the
 * SELECT … FOR UPDATE lock, and idempotency replay. Those tests
 * belong in the e2e suite.
 *
 * What this file covers — the pure side of the deduction:
 *   - Credit ≤ remaining balance (the plain happy path)
 *   - Credit ≤ remaining daily allowance (daily-cap binding)
 *   - Credit = balance, paid covers the overflow (partial split)
 *   - Daily cap fully spent → credit = 0n, full cost goes to paid
 *   - Daily window reset when wall clock crosses 24h
 *   - applyBpsDiscount edge cases (0%, 50%, 100%, oversized)
 *
 * `__test` is the credit-store module's escape hatch — exposes the
 * pure helpers without making them part of the public API.
 */

import { describe, expect, test } from 'bun:test';

import { __test } from '@/lib/credit-store';

const { planSplit, applyBpsDiscount } = __test;

const NOW = new Date('2026-04-27T20:00:00Z');
const ONE_HOUR_AGO = new Date(NOW.getTime() - 60 * 60 * 1000);
const TWO_DAYS_AGO = new Date(NOW.getTime() - 48 * 60 * 60 * 1000);

describe('planSplit — full credit coverage', () => {
  test('cost <= balance, no daily cap → fully credited', () => {
    const split = planSplit(
      { meterBalanceMicro: 5_000_000n, dailyCreditBurnMicro: 0n, dailyWindowStartedAt: NOW },
      1_000n,
      null,
      NOW
    );
    expect(split.creditMicro).toBe(1_000n);
    expect(split.paidMicroPreDiscount).toBe(0n);
    expect(split.newBalanceMicro).toBe(4_999_000n);
    expect(split.newDailyBurnMicro).toBe(1_000n);
  });

  test('cost <= balance, within daily cap → fully credited', () => {
    const split = planSplit(
      { meterBalanceMicro: 5_000_000n, dailyCreditBurnMicro: 100_000n, dailyWindowStartedAt: NOW },
      50_000n,
      1_250_000n, // Basic daily cap
      NOW
    );
    expect(split.creditMicro).toBe(50_000n);
    expect(split.paidMicroPreDiscount).toBe(0n);
    expect(split.newDailyBurnMicro).toBe(150_000n);
  });
});

describe('planSplit — partial split (balance < cost)', () => {
  test('cost > balance, no daily cap → split into credit + paid', () => {
    const split = planSplit(
      { meterBalanceMicro: 1_000n, dailyCreditBurnMicro: 0n, dailyWindowStartedAt: NOW },
      5_000n,
      null,
      NOW
    );
    expect(split.creditMicro).toBe(1_000n);
    expect(split.paidMicroPreDiscount).toBe(4_000n);
    expect(split.newBalanceMicro).toBe(0n);
  });

  test('zero balance → entire cost goes to paid', () => {
    const split = planSplit(
      { meterBalanceMicro: 0n, dailyCreditBurnMicro: 0n, dailyWindowStartedAt: NOW },
      10_000n,
      null,
      NOW
    );
    expect(split.creditMicro).toBe(0n);
    expect(split.paidMicroPreDiscount).toBe(10_000n);
    expect(split.newBalanceMicro).toBe(0n);
    expect(split.newDailyBurnMicro).toBe(0n);
  });
});

describe('planSplit — daily-cap binding', () => {
  test('daily cap tighter than balance → credit limited by daily', () => {
    // Balance has 5_000_000n but daily cap leaves only 100_000n
    // remaining for credit. Cost is 200_000n. Credit = 100_000n,
    // paid = 100_000n.
    const split = planSplit(
      {
        meterBalanceMicro: 5_000_000n,
        dailyCreditBurnMicro: 1_150_000n, // 1.15 of 1.25 daily cap
        dailyWindowStartedAt: NOW,
      },
      200_000n,
      1_250_000n,
      NOW
    );
    expect(split.creditMicro).toBe(100_000n);
    expect(split.paidMicroPreDiscount).toBe(100_000n);
    expect(split.newDailyBurnMicro).toBe(1_250_000n);
  });

  test('daily cap fully spent → credit 0, all cost to paid', () => {
    const split = planSplit(
      {
        meterBalanceMicro: 5_000_000n,
        dailyCreditBurnMicro: 1_250_000n, // exactly at cap
        dailyWindowStartedAt: NOW,
      },
      50_000n,
      1_250_000n,
      NOW
    );
    expect(split.creditMicro).toBe(0n);
    expect(split.paidMicroPreDiscount).toBe(50_000n);
    expect(split.newBalanceMicro).toBe(5_000_000n); // untouched
    expect(split.newDailyBurnMicro).toBe(1_250_000n); // unchanged
  });

  test('daily burn already over cap (defensive) → credit clamps to 0', () => {
    // Should never happen in practice (the conditional UPDATE
    // prevents it) but the math must not go negative.
    const split = planSplit(
      {
        meterBalanceMicro: 5_000_000n,
        dailyCreditBurnMicro: 1_500_000n, // somehow over the cap
        dailyWindowStartedAt: NOW,
      },
      10_000n,
      1_250_000n,
      NOW
    );
    expect(split.creditMicro).toBe(0n);
    expect(split.paidMicroPreDiscount).toBe(10_000n);
  });
});

describe('planSplit — daily window reset', () => {
  test('window started >24h ago → daily counter resets to 0 + new window opens', () => {
    const split = planSplit(
      {
        meterBalanceMicro: 5_000_000n,
        dailyCreditBurnMicro: 1_250_000n, // was at cap yesterday
        dailyWindowStartedAt: TWO_DAYS_AGO,
      },
      50_000n,
      1_250_000n,
      NOW
    );
    // Daily resets, so credit covers full cost
    expect(split.creditMicro).toBe(50_000n);
    expect(split.paidMicroPreDiscount).toBe(0n);
    expect(split.newDailyBurnMicro).toBe(50_000n); // not 1_300_000
    expect(split.newWindowStart).toBe(NOW);
  });

  test('window started <24h ago → counter NOT reset', () => {
    const split = planSplit(
      {
        meterBalanceMicro: 5_000_000n,
        dailyCreditBurnMicro: 100_000n,
        dailyWindowStartedAt: ONE_HOUR_AGO,
      },
      50_000n,
      1_250_000n,
      NOW
    );
    expect(split.creditMicro).toBe(50_000n);
    expect(split.newDailyBurnMicro).toBe(150_000n); // accumulates
    expect(split.newWindowStart).toBe(ONE_HOUR_AGO); // unchanged
  });

  test('null windowStart → treated as expired, opens fresh window', () => {
    const split = planSplit(
      {
        meterBalanceMicro: 5_000_000n,
        dailyCreditBurnMicro: 0n,
        dailyWindowStartedAt: null,
      },
      50_000n,
      1_250_000n,
      NOW
    );
    expect(split.creditMicro).toBe(50_000n);
    expect(split.newDailyBurnMicro).toBe(50_000n);
    expect(split.newWindowStart).toBe(NOW);
  });
});

describe('applyBpsDiscount', () => {
  test('0 bps discount = identity', () => {
    expect(applyBpsDiscount(10_000n, 0)).toBe(10_000n);
  });

  test('5_000 bps discount = 50% off (Enterprise overage)', () => {
    expect(applyBpsDiscount(10_000n, 5_000)).toBe(5_000n);
  });

  test('1_500 bps = 15% off (Basic)', () => {
    expect(applyBpsDiscount(10_000n, 1_500)).toBe(8_500n);
  });

  test('3_000 bps = 30% off (Pro)', () => {
    expect(applyBpsDiscount(10_000n, 3_000)).toBe(7_000n);
  });

  test('10_000 bps = 100% off → 0', () => {
    expect(applyBpsDiscount(10_000n, 10_000)).toBe(0n);
  });

  test('over-100% bps clamps to 0 (no negative charges)', () => {
    expect(applyBpsDiscount(10_000n, 15_000)).toBe(0n);
  });

  test('negative bps treated as 0% (no inadvertent markup)', () => {
    expect(applyBpsDiscount(10_000n, -100)).toBe(10_000n);
  });

  test('integer truncation rounds down per BigInt semantics', () => {
    // 199 × (10000 - 1500) / 10000 = 199 × 8500 / 10000
    //  = 1_691_500 / 10_000 = 169 (truncated from 169.15)
    expect(applyBpsDiscount(199n, 1_500)).toBe(169n);
  });
});
