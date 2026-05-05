import { test, expect } from 'bun:test';

import { deriveStayCancellation } from './index';

test('returns "unknown" when rooms array is empty (list-search path)', () => {
  expect(deriveStayCancellation([])).toBe('unknown');
});

test('returns "unknown" when rooms exist but rates were not fetched', () => {
  expect(deriveStayCancellation([{ rates: [] }, { rates: undefined }])).toBe('unknown');
});

test('returns "free" when any rate has a full-refund timeline entry', () => {
  expect(
    deriveStayCancellation([
      {
        rates: [
          {
            total_amount: '100.00',
            cancellation_timeline: [{ refund_amount: '100.00' }],
          },
        ],
      },
    ])
  ).toBe('free');
});

test('returns "free" when full refund lives on a different room than the cheapest', () => {
  expect(
    deriveStayCancellation([
      { rates: [{ total_amount: '90.00', cancellation_timeline: [] }] },
      {
        rates: [
          {
            total_amount: '120.00',
            cancellation_timeline: [{ refund_amount: '120.00' }],
          },
        ],
      },
    ])
  ).toBe('free');
});

test('returns "partial" when timelines exist but never reach full refund', () => {
  expect(
    deriveStayCancellation([
      {
        rates: [
          {
            total_amount: '100.00',
            cancellation_timeline: [{ refund_amount: '60.00' }],
          },
        ],
      },
    ])
  ).toBe('partial');
});

test('returns "non_refundable" when rates are present with empty timelines', () => {
  expect(
    deriveStayCancellation([
      { rates: [{ total_amount: '100.00', cancellation_timeline: [] }] },
      { rates: [{ total_amount: '120.00', cancellation_timeline: [] }] },
    ])
  ).toBe('non_refundable');
});

test('does not throw on malformed amount strings', () => {
  // parseFloat('') === NaN; NaN >= NaN is false → falls through to non_refundable.
  expect(
    deriveStayCancellation([
      {
        rates: [
          {
            total_amount: 'oops',
            cancellation_timeline: [{ refund_amount: 'wat' }],
          },
        ],
      },
    ])
  ).toBe('partial');
});
