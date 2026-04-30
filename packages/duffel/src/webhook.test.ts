import { test, expect } from 'bun:test';
import { createHmac } from 'node:crypto';
import { verifyDuffelSignature, parseDuffelWebhook } from './webhook';

const secret = 'whsec_test_abc';

function sign(body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

test('verifyDuffelSignature: accepts a valid signature', () => {
  const body = JSON.stringify({ id: 'evt_1' });
  expect(verifyDuffelSignature(body, sign(body), secret)).toBe(true);
});

test('verifyDuffelSignature: rejects a tampered body', () => {
  const body = JSON.stringify({ id: 'evt_1' });
  const sig = sign(body);
  expect(verifyDuffelSignature(body + 'extra', sig, secret)).toBe(false);
});

test('verifyDuffelSignature: rejects null/empty signature', () => {
  expect(verifyDuffelSignature('{}', null, secret)).toBe(false);
  expect(verifyDuffelSignature('{}', '', secret)).toBe(false);
});

test('parseDuffelWebhook: normalizes order.created ticketed', () => {
  const raw = JSON.stringify({
    id: 'evt_1',
    type: 'order.created',
    data: { id: 'ord_abc', status: 'ticketed' },
  });
  const ev = parseDuffelWebhook(raw);
  expect(ev.id).toBe('evt_1');
  expect(ev.type).toBe('order.created');
  expect(ev.orderId).toBe('ord_abc');
  expect(ev.status).toBe('ticketed');
});

test('parseDuffelWebhook: normalizes order.updated cancelled', () => {
  const raw = JSON.stringify({
    id: 'evt_2',
    type: 'order.updated',
    data: { id: 'ord_def', status: 'cancelled' },
  });
  const ev = parseDuffelWebhook(raw);
  expect(ev.status).toBe('cancelled');
});

test('parseDuffelWebhook: throws on malformed JSON', () => {
  expect(() => parseDuffelWebhook('not-json')).toThrow();
});

test('parseDuffelWebhook: throws when required fields missing', () => {
  expect(() => parseDuffelWebhook('{}')).toThrow();
});
