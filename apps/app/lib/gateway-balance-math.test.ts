/**
 * Regression tests for grandTotal computation.
 *
 * Load-bearing invariant: `grandTotal` must NOT double-count money
 * that has already landed in the Gateway pool but whose deposit log is
 * still inside the `FINALIZATION_ETA_MS` window.
 *
 * Why this matters: after a sweep credits the Gateway pool, the same
 * USDC is reflected in `available` (Gateway API balance) AND in the
 * `pendingCredits` log row (status='confirmed', within ETA). Summing
 * `available + pendingCredits + opsStaging` was inflating the UI
 * balance by exactly the pending amount for several minutes after
 * every sweep.
 *
 * Fix (2026-05-10): `grandTotal = available + opsStaging`. pending-
 * credits stays as a separate field on the API for informational UI.
 */

import { describe, expect, test } from 'bun:test';

import {
  calculateGatewayBalanceTotals,
  decimalUsdcToMicro,
  microUsdcToDecimal,
} from './gateway-balance-math';

describe('gateway balance math', () => {
  test('grandTotal does not double-count pendingCredits already reflected in available', () => {
    // Sweep just credited Gateway pool with $10. The same deposit log
    // is still inside the FINALIZATION_ETA_MS window, so both layers
    // report it.
    const totals = calculateGatewayBalanceTotals({
      perDomain: [{ domain: 5, balance: '10.000000' }],
      pendingCredits: [
        { domain: 5, amount: decimalUsdcToMicro('10').toString() },
      ],
      opsStaging: [],
    });
    // Correct answer is $10, not $20.
    expect(microUsdcToDecimal(totals.grandTotalMicro)).toBe('10.000000');
  });

  test('grandTotal includes opsStaging (pre-sweep DCW balance)', () => {
    // Bridge minted to ops DCW; sweep has not yet fired. The DCW holds
    // $1 and the Gateway pool is empty. opsStaging is the only layer
    // that surfaces this.
    const totals = calculateGatewayBalanceTotals({
      perDomain: [{ domain: 1, balance: '0.000000' }],
      pendingCredits: [],
      opsStaging: [
        { chain: 'AVAX-FUJI', usdc: decimalUsdcToMicro('1').toString() },
      ],
    });
    expect(microUsdcToDecimal(totals.grandTotalMicro)).toBe('1.000000');
  });

  test('grandTotal = available + opsStaging, no contribution from pendingCredits', () => {
    // Combined scenario: $19.75 in pools across three chains, $7 mid-
    // sweep at DCWs, $3 in pending logs (already reflected in
    // available). Correct headline = 19.75 + 7 = 26.75.
    const totals = calculateGatewayBalanceTotals({
      perDomain: [
        { domain: 26, balance: '10.000000' },
        { domain: 3, balance: '2.500000' },
        { domain: 5, balance: '7.250000' },
      ],
      pendingCredits: [
        { domain: 26, amount: '1000000' },
        { domain: 5, amount: '2000000' },
      ],
      opsStaging: [
        { chain: 'ARC-TESTNET', usdc: '3000000' },
        { chain: 'SOL-DEVNET', usdc: '4000000' },
      ],
    });

    expect(microUsdcToDecimal(totals.availableMicro)).toBe('19.750000');
    expect(microUsdcToDecimal(totals.opsStagingMicro)).toBe('7.000000');
    expect(microUsdcToDecimal(totals.grandTotalMicro)).toBe('26.750000');

    // Every Gateway-supported domain is spendable today (the Solana
    // carve-out was retired). Spendable totals mirror the full totals.
    expect(microUsdcToDecimal(totals.spendableAvailableMicro)).toBe('19.750000');
    expect(microUsdcToDecimal(totals.spendableTotalMicro)).toBe('26.750000');
    expect(microUsdcToDecimal(totals.unsupportedSourceMicro)).toBe('0.000000');

    // pendingCredits is still surfaced for informational UI even
    // though it no longer counts toward grandTotal.
    expect(microUsdcToDecimal(totals.pendingCreditMicro)).toBe('3.000000');
  });

  test('empty inputs return zero totals', () => {
    const totals = calculateGatewayBalanceTotals({
      perDomain: [],
      pendingCredits: [],
      opsStaging: [],
    });
    expect(totals.grandTotalMicro).toBe(0n);
    expect(totals.spendableTotalMicro).toBe(0n);
  });

  test('parses and formats six-decimal USDC exactly', () => {
    expect(decimalUsdcToMicro('98.366900')).toBe(98_366_900n);
    expect(decimalUsdcToMicro('0.01')).toBe(10_000n);
    expect(microUsdcToDecimal(98_366_900n)).toBe('98.366900');
  });
});
