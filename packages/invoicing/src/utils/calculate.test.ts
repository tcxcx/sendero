import { test, expect } from 'bun:test';
import { calculateTotals } from './calculate';

test('single line item, no tax/vat/discount', () => {
  const out = calculateTotals({
    lineItems: [{ quantity: 1, unitPriceMicro: 1_000_000_000n }],
  });
  expect(out.subtotalMicro).toBe(1_000_000_000n);
  expect(out.totalMicro).toBe(1_000_000_000n);
});

test('multiple items', () => {
  const out = calculateTotals({
    lineItems: [
      { quantity: 2, unitPriceMicro: 500_000_000n },
      { quantity: 3, unitPriceMicro: 100_000_000n },
    ],
  });
  expect(out.subtotalMicro).toBe(1_300_000_000n);
  expect(out.totalMicro).toBe(1_300_000_000n);
});

test('with tax + vat + discount', () => {
  const out = calculateTotals({
    lineItems: [{ quantity: 1, unitPriceMicro: 1_000_000_000n }],
    taxRate: 0.08,
    vatRate: 0.2,
    discountMicro: 100_000_000n,
  });
  expect(out.subtotalMicro).toBe(1_000_000_000n);
  expect(out.discountMicro).toBe(100_000_000n);
  expect(out.taxAmountMicro).toBe(72_000_000n);
  expect(out.vatAmountMicro).toBe(180_000_000n);
  expect(out.totalMicro).toBe(1_152_000_000n);
});

test('fractional quantities', () => {
  const out = calculateTotals({
    lineItems: [{ quantity: 2.5, unitPriceMicro: 100_000_000n }],
  });
  expect(out.subtotalMicro).toBe(250_000_000n);
});
