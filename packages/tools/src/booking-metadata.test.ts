/**
 * Track C2 — booking-metadata helpers.
 *
 * Pure unit tests, no IO. Asserts the segment → itemization defaulting
 * matrix that drives the customer-facing invoice shape.
 */

import { describe, expect, test } from 'bun:test';
import {
  defaultItemizationForSegment,
  parseBookingMetadata,
  readBookingSegment,
  readInvoiceItemization,
  serializeBookTripMetadata,
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

describe('parseBookingMetadata + serializeBookTripMetadata (Codex review f + PR54-5)', () => {
  test('book_trip variant — valid payload parses', () => {
    const serialized = serializeBookTripMetadata({
      sliceIndex: 0,
      offerId: 'off_00009htYpSCXrwaB9Dn456',
    });
    const parsed = parseBookingMetadata(serialized);
    expect(parsed?.source).toBe('book_trip');
    if (parsed?.source === 'book_trip') {
      expect(parsed.sliceIndex).toBe(0);
      expect(parsed.offerId).toBe('off_00009htYpSCXrwaB9Dn456');
      expect(parsed.splitTicket).toBe(true);
    }
  });

  test('book_trip variant — wrong offerId shape rejected', () => {
    const bad = {
      source: 'book_trip' as const,
      sliceIndex: 0,
      offerId: 'not_an_offer_id',
      splitTicket: true as const,
    };
    expect(parseBookingMetadata(bad)).toBe(null);
  });

  test('book_flight variant — valid payload parses (paymentStatus required, others passthrough)', () => {
    const stamped = {
      source: 'book_flight',
      paymentStatus: 'paid',
      // arbitrary additional fields book_flight legitimately writes
      usdcSettlement: { amount: '120.00', currency: 'USD' },
      eTicketUrl: 'https://example.com/ticket.pdf',
    };
    const parsed = parseBookingMetadata(stamped);
    expect(parsed?.source).toBe('book_flight');
    if (parsed?.source === 'book_flight') {
      expect(parsed.paymentStatus).toBe('paid');
    }
  });

  test('book_flight variant — missing paymentStatus rejected (PR54-5)', () => {
    // Before PR54-5 the schema accepted source:'book_flight' alone via
    // .passthrough(). Now paymentStatus is required to catch a
    // malformed source-tagged blob at the validator boundary.
    const malformed = { source: 'book_flight', someOtherField: 'value' };
    expect(parseBookingMetadata(malformed)).toBe(null);
  });

  test('legacy / no-source metadata — passes through as null', () => {
    // Today book_flight writes { paymentStatus, usdcSettlement? } with
    // no `source` field. The discriminated union doesn't match → null,
    // which is the safe defensive behavior.
    const legacy = { paymentStatus: 'paid', usdcSettlement: { amount: '50' } };
    expect(parseBookingMetadata(legacy)).toBe(null);
  });

  test('non-object / nullish input — returns null', () => {
    expect(parseBookingMetadata(null)).toBe(null);
    expect(parseBookingMetadata(undefined)).toBe(null);
    expect(parseBookingMetadata('string')).toBe(null);
    expect(parseBookingMetadata(42)).toBe(null);
  });
});
