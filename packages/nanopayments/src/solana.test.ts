/**
 * Phase 6 — pure-validation tests for the Solana adapter helpers.
 *
 * `parseMicroUsdc` is the only piece worth unit-testing without a
 * devnet round-trip; the actual transfer flow needs a live RPC and
 * a funded platform wallet, which belongs in an integration suite,
 * not here.
 */

import { describe, expect, test } from 'bun:test';

import { parseMicroUsdc } from './solana';

describe('parseMicroUsdc', () => {
  test('integer dollar value', () => {
    expect(parseMicroUsdc('1')).toBe(1_000_000n);
    expect(parseMicroUsdc('1234')).toBe(1_234_000_000n);
  });

  test('full 6-decimal precision', () => {
    expect(parseMicroUsdc('1.234567')).toBe(1_234_567n);
  });

  test('shorter fractional pads with zeros', () => {
    expect(parseMicroUsdc('1.5')).toBe(1_500_000n);
    expect(parseMicroUsdc('0.02')).toBe(20_000n);
  });

  test('zero is allowed by the parser (caller rejects)', () => {
    expect(parseMicroUsdc('0')).toBe(0n);
    expect(parseMicroUsdc('0.000000')).toBe(0n);
  });

  test('rejects > 6 fractional digits', () => {
    expect(() => parseMicroUsdc('1.1234567')).toThrow(/decimals/);
  });

  test('rejects negatives', () => {
    expect(() => parseMicroUsdc('-1')).toThrow(/invalid/);
  });

  test('rejects garbage', () => {
    expect(() => parseMicroUsdc('abc')).toThrow();
    expect(() => parseMicroUsdc('1.2.3')).toThrow();
    expect(() => parseMicroUsdc('')).toThrow();
  });
});
