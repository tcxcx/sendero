import { describe, expect, test } from 'bun:test';

import { buildStayResolvedBlocks, parseStayBookingAction } from './slack-stay-actions';

describe('parseStayBookingAction', () => {
  test('returns null for unrelated action_ids', () => {
    expect(
      parseStayBookingAction({ action_id: 'sendero_approval.approve', value: '{}' })
    ).toBeNull();
    expect(parseStayBookingAction({ action_id: 'open_link', value: 'https://x' })).toBeNull();
  });

  test('returns null when value is missing', () => {
    expect(parseStayBookingAction({ action_id: 'confirm_stay_booking' })).toBeNull();
    expect(parseStayBookingAction({ action_id: 'confirm_stay_booking', value: '' })).toBeNull();
  });

  test('returns null when value is not valid JSON', () => {
    expect(
      parseStayBookingAction({ action_id: 'confirm_stay_booking', value: '{not json' })
    ).toBeNull();
  });

  test('returns null when any required field is missing', () => {
    const base = { q: 'quo_1', t: 'ten_1', e: 'a@b.com', g: 'A', f: 'B' };
    for (const k of ['q', 't', 'e', 'g', 'f'] as const) {
      const trimmed = { ...base } as Record<string, string>;
      delete trimmed[k];
      expect(
        parseStayBookingAction({
          action_id: 'confirm_stay_booking',
          value: JSON.stringify(trimmed),
        })
      ).toBeNull();
    }
  });

  test('decodes a confirm payload + carries optional tripId', () => {
    const value = JSON.stringify({
      q: 'quo_1',
      t: 'ten_1',
      tr: 'trip_42',
      e: 'a@b.com',
      g: 'Casey',
      f: 'Traveler',
    });
    const parsed = parseStayBookingAction({ action_id: 'confirm_stay_booking', value });
    expect(parsed).toEqual({
      decision: 'confirm',
      quoteId: 'quo_1',
      tenantId: 'ten_1',
      tripId: 'trip_42',
      travelerEmail: 'a@b.com',
      travelerGivenName: 'Casey',
      travelerFamilyName: 'Traveler',
    });
  });

  test('decodes a cancel payload + tripId stays null when omitted', () => {
    const value = JSON.stringify({ q: 'quo_2', t: 'ten_1', e: 'a@b.com', g: 'A', f: 'B' });
    const parsed = parseStayBookingAction({ action_id: 'cancel_stay_booking', value });
    expect(parsed?.decision).toBe('cancel');
    expect(parsed?.tripId).toBeNull();
  });
});

describe('buildStayResolvedBlocks', () => {
  test('confirmed surfaces booking reference + amount in section', () => {
    const blocks = buildStayResolvedBlocks(
      {
        hotelName: 'Duffel Test Hotel',
        reference: 'AFE33SE2',
        checkInDate: '2026-06-04',
        checkOutDate: '2026-06-07',
        totalAmount: '1355.38',
        totalCurrency: 'USD',
      },
      'confirmed',
      'U123'
    );
    const sectionText = (blocks[1] as { text: { text: string } }).text.text;
    expect(sectionText).toContain('AFE33SE2');
    expect(sectionText).toContain('Duffel Test Hotel');
    expect(sectionText).toContain('1355.38');
    expect((blocks[0] as { text: { text: string } }).text.text).toContain('Booked');
  });

  test('canceled has no reference line', () => {
    const blocks = buildStayResolvedBlocks({ hotelName: 'Hotel quote' }, 'canceled', 'U123');
    const sectionText = (blocks[1] as { text: { text: string } }).text.text;
    expect(sectionText).not.toContain('Booking reference');
    expect((blocks[0] as { text: { text: string } }).text.text).toContain('Canceled');
  });

  test('failed surfaces the error message in italic', () => {
    const blocks = buildStayResolvedBlocks(
      { hotelName: 'Hotel quote' },
      'failed',
      'U123',
      'Quote expired'
    );
    const sectionText = (blocks[1] as { text: { text: string } }).text.text;
    expect(sectionText).toContain('_Quote expired_');
    expect((blocks[0] as { text: { text: string } }).text.text).toContain('Booking failed');
  });
});
