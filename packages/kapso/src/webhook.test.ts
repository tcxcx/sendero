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

  it('extracts root v2 whatsapp.message.received payload fields', () => {
    const event = parseProjectEvent({
      message: {
        id: 'wamid.123',
        timestamp: '1730092800',
        type: 'text',
        text: { body: 'Hello' },
        kapso: {
          direction: 'inbound',
          status: 'received',
          content: 'Hello',
        },
      },
      conversation: {
        id: 'conv_123',
        phone_number: '+15551234567',
        phone_number_id: '123456789012345',
      },
      is_new_conversation: true,
      phone_number_id: '123456789012345',
    });

    expect(event).toEqual({
      kind: 'whatsapp.message.received',
      direction: 'inbound',
      phoneNumberId: '123456789012345',
      customerId: null,
      customerPhone: '+15551234567',
      conversationId: 'conv_123',
      wamid: 'wamid.123',
      messageType: 'text',
      text: 'Hello',
      timestamp: 1730092800,
    });
  });

  it('extracts buffered v2 whatsapp.message.received payload fields', () => {
    const event = parseProjectEvent({
      type: 'whatsapp.message.received',
      data: [
        {
          message: {
            id: 'wamid.outbound',
            timestamp: '1730092799',
            type: 'text',
            text: { body: 'Bot echo' },
            kapso: { direction: 'outbound', content: 'Bot echo' },
          },
          conversation: {
            id: 'conv_123',
            phone_number: '15551234567',
            phone_number_id: '123456789012345',
          },
          phone_number_id: '123456789012345',
        },
        {
          message: {
            id: 'wamid.inbound',
            timestamp: '1730092800',
            type: 'text',
            text: { body: 'Buffered hello' },
            kapso: { direction: 'inbound', content: 'Buffered hello' },
          },
          conversation: {
            id: 'conv_123',
            phone_number: '+15551234567',
            phone_number_id: '123456789012345',
          },
          phone_number_id: '123456789012345',
        },
      ],
    });

    expect(event).toEqual({
      kind: 'whatsapp.message.received',
      direction: 'inbound',
      phoneNumberId: '123456789012345',
      customerId: null,
      customerPhone: '+15551234567',
      conversationId: 'conv_123',
      wamid: 'wamid.inbound',
      messageType: 'text',
      text: 'Buffered hello',
      timestamp: 1730092800,
    });
  });

  it('extracts outbound v2 whatsapp.message.sent payload fields', () => {
    const event = parseProjectEvent({
      type: 'whatsapp.message.sent',
      data: {
        message: {
          id: 'wamid.sent',
          timestamp: '1730092860',
          type: 'text',
          text: { body: 'On my way' },
          kapso: {
            direction: 'outbound',
            status: 'sent',
            content: 'On my way',
          },
        },
        conversation: {
          id: 'conv_123',
          phone_number: '15551234567',
          phone_number_id: '123456789012345',
        },
        phone_number_id: '123456789012345',
      },
    });

    expect(event).toEqual({
      kind: 'whatsapp.message.sent',
      direction: 'outbound',
      phoneNumberId: '123456789012345',
      customerId: null,
      customerPhone: '+15551234567',
      conversationId: 'conv_123',
      wamid: 'wamid.sent',
      messageType: 'text',
      text: 'On my way',
      timestamp: 1730092860,
    });
  });

  it('returns null for unknown events', () => {
    const event = parseProjectEvent({ type: 'whatsapp.something_else', data: {} });
    expect(event).toBeNull();
  });
});
