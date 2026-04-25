/**
 * Track C2 — booking-metadata helpers.
 *
 * Pure unit tests, no IO. Asserts the segment → itemization defaulting
 * matrix that drives the customer-facing invoice shape.
 */

import { describe, expect, test } from 'bun:test';
import {
  defaultItemizationForSegment,
  readBookingSegment,
  readInvoiceItemization,
} from './booking-metadata';

describe('defaultItemizationForSegment', () => {
  test('corporate → itemized (B2B expense compliance)', () => {
    expect(defaultItemizationForSegment('corporate')).toBe('itemized');
  });

  test('agency → itemized', () => {
    expect(defaultItemizationForSegment('agency')).toBe('itemized');
  });

  test('consumer → single (clean Booking.com-style UX)', () => {
    expect(defaultItemizationForSegment('consumer')).toBe('single');
  });

  test('leisure → single', () => {
    expect(defaultItemizationForSegment('leisure')).toBe('single');
  });

  test('null → single (safe default)', () => {
    expect(defaultItemizationForSegment(null)).toBe('single');
  });

  test('undefined → single (safe default)', () => {
    expect(defaultItemizationForSegment(undefined)).toBe('single');
  });

  test('unknown segment → single (safe default; never throws)', () => {
    expect(defaultItemizationForSegment('something_new')).toBe('single');
  });
});

describe('readInvoiceItemization', () => {
  test('returns the itemization string when present', () => {
    expect(readInvoiceItemization({ invoiceItemization: 'itemized' })).toBe('itemized');
    expect(readInvoiceItemization({ invoiceItemization: 'single' })).toBe('single');
  });

  test('returns null when the key is absent', () => {
    expect(readInvoiceItemization({})).toBe(null);
    expect(readInvoiceItemization(null)).toBe(null);
    expect(readInvoiceItemization(undefined)).toBe(null);
  });

  test('returns null when the key holds a malformed value', () => {
    expect(readInvoiceItemization({ invoiceItemization: 'invalid' })).toBe(null);
    expect(readInvoiceItemization({ invoiceItemization: 42 })).toBe(null);
    expect(readInvoiceItemization({ invoiceItemization: null })).toBe(null);
  });
});

describe('readBookingSegment', () => {
  test('returns the segment string when present', () => {
    expect(readBookingSegment({ segment: 'corporate' })).toBe('corporate');
    expect(readBookingSegment({ segment: 'consumer' })).toBe('consumer');
  });

  test('returns null when missing or non-string', () => {
    expect(readBookingSegment({})).toBe(null);
    expect(readBookingSegment(null)).toBe(null);
    expect(readBookingSegment(undefined)).toBe(null);
    expect(readBookingSegment({ segment: 7 })).toBe(null);
  });
});
