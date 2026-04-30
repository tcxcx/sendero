/**
 * Kapso webhook signature + parser tests.
 *
 * Ported from desk-v1 verifyWebhookSignature tests, adapted for Sendero.
 */

import crypto from 'node:crypto';
import { describe, expect, it } from 'bun:test';
import { parseProjectEvent, verifyKapsoSignature } from './webhook';

const SECRET = 'test-secret';

describe('verifyKapsoSignature', () => {
  const body = JSON.stringify({ hello: 'world' });
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('hex');

  it('accepts bare hex signature (Kapso format)', () => {
    expect(verifyKapsoSignature(body, sig, SECRET)).toBe(true);
  });

  it('accepts sha256=<hex> prefix (Meta format)', () => {
    expect(verifyKapsoSignature(body, `sha256=${sig}`, SECRET)).toBe(true);
  });

  it('rejects missing signature', () => {
    expect(verifyKapsoSignature(body, null, SECRET)).toBe(false);
    expect(verifyKapsoSignature(body, '', SECRET)).toBe(false);
  });

  it('rejects wrong secret', () => {
    expect(verifyKapsoSignature(body, sig, 'other-secret')).toBe(false);
  });

  it('rejects tampered body', () => {
    const tampered = body.replace('world', 'earth');
    expect(verifyKapsoSignature(tampered, sig, SECRET)).toBe(false);
  });
});

describe('parseProjectEvent', () => {
  it('extracts phone_number.created fields', () => {
    const event = parseProjectEvent({
      type: 'whatsapp.phone_number.created',
      data: {
        customer_id: 'cus_1',
        phone_number_id: 'pn_1',
        business_account_id: 'waba_1',
        display_phone_number: '+15555550100',
        verified_name: 'Sendero Travel',
      },
    });
    expect(event?.kind).toBe('phone_number.created');
    expect(event?.phoneNumberId).toBe('pn_1');
    expect(event?.verifiedName).toBe('Sendero Travel');
  });

  it('returns null for unknown events', () => {
    const event = parseProjectEvent({ type: 'whatsapp.something_else', data: {} });
    expect(event).toBeNull();
  });
});
