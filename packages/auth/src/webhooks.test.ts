import { test, expect } from 'bun:test';
import { Webhook } from 'svix';
import { verifyClerkWebhook } from './webhooks';

const SECRET = 'whsec_dGVzdC1zZWNyZXQtZm9yLWNsZXJrLXdlYmhvb2tzLWF0LWxlYXN0LTMyLWJ5dGVz';

function signPayload(body: string) {
  const wh = new Webhook(SECRET);
  const id = 'msg_' + Date.now();
  const timestamp = new Date();
  const signature = wh.sign(id, timestamp, body);
  return {
    'svix-id': id,
    'svix-timestamp': Math.floor(timestamp.getTime() / 1000).toString(),
    'svix-signature': signature,
  };
}

test('verifyClerkWebhook accepts valid signature', () => {
  const body = JSON.stringify({ type: 'user.created', data: { id: 'user_123' } });
  const headers = signPayload(body);
  const event = verifyClerkWebhook(body, headers, SECRET);
  expect(event.type).toBe('user.created');
  expect((event.data as { id: string }).id).toBe('user_123');
});

test('verifyClerkWebhook rejects tampered body', () => {
  const body = JSON.stringify({ type: 'user.created', data: { id: 'user_123' } });
  const headers = signPayload(body);
  expect(() => verifyClerkWebhook(body + 'extra', headers, SECRET)).toThrow();
});

test('verifyClerkWebhook rejects missing headers', () => {
  const body = '{"type":"user.created","data":{}}';
  expect(() => verifyClerkWebhook(body, {}, SECRET)).toThrow();
});
