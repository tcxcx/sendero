import { test, expect } from 'bun:test';
import { microToDecimal, decimalToMicro, formatMoney } from './number';

test('microToDecimal', () => {
  expect(microToDecimal(1_000_000n)).toBe('1.000000');
  expect(microToDecimal(0n)).toBe('0.000000');
  expect(microToDecimal(1n)).toBe('0.000001');
});

test('decimalToMicro', () => {
  expect(decimalToMicro('1.00')).toBe(1_000_000n);
  expect(decimalToMicro('0.000001')).toBe(1n);
  expect(decimalToMicro('1350.50')).toBe(1_350_500_000n);
});

test('formatMoney', () => {
  expect(formatMoney(1_350_500_000n, 'USD', 'en-US')).toBe('$1,350.50');
  expect(formatMoney(0n, 'USD', 'en-US')).toBe('$0.00');
  expect(formatMoney(100n, 'USD', 'en-US')).toBe('$0.00');
});

test('formatMoney respects locale', () => {
  const formatted = formatMoney(1_350_500_000n, 'EUR', 'de-DE');
  expect(formatted).toMatch(/1\.350,50/);
});
