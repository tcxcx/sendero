/**
 * Regression tests for Circle webhook signature verification.
 *
 * Run: `bun test apps/app/lib/circle-webhook-verify.test.ts`
 *
 * The bug under test: production webhook 401s because
 * `getCirclePublicKey` was calling `https://api.circle.com/v2/notifications/publicKey/{id}`
 * without `Authorization: Bearer ${CIRCLE_API_KEY}`. Circle returned
 * 401, our fetch returned null, the gate rejected with
 * `public_key_fetch_failed`, and Circle Console showed "non-2XX 401"
 * for every delivery. Confirmed by curling the endpoint with and
 * without the header.
 *
 * The follow-on bug: even if we fixed auth, Circle returns the public
 * key as raw base64 (no PEM banners) and Node's `crypto.createVerify`
 * needs PEM. We wrap if not already wrapped.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import { gateCircleWebhook, getCirclePublicKey } from './circle-webhook-verify';

// Bun's `mock` doesn't replace globalThis.fetch on its own — install
// the spy manually so we can assert the headers we sent and control
// the response shape per test.
const originalFetch = globalThis.fetch;
let fetchCalls: Array<{ url: string; init?: RequestInit }> = [];

beforeEach(() => {
  fetchCalls = [];
  process.env.CIRCLE_API_KEY = 'test-circle-key';
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function installFetch(handler: (url: string, init?: RequestInit) => Response): void {
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    fetchCalls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
}

describe('getCirclePublicKey', () => {
  test('sends Authorization: Bearer header (the bug we just fixed)', async () => {
    installFetch(() =>
      Response.json({
        data: {
          publicKey: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA',
        },
      })
    );

    await getCirclePublicKey('11111111-2222-3333-4444-555555555555');

    expect(fetchCalls).toHaveLength(1);
    const headers = fetchCalls[0].init?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBe('Bearer test-circle-key');
    // Pre-fix code sent NO headers at all. This assertion fails on the
    // old impl, passes on the fix.
  });

  test('returns null + logs when CIRCLE_API_KEY is missing', async () => {
    delete process.env.CIRCLE_API_KEY;
    installFetch(() => new Response('should not be called', { status: 200 }));

    const result = await getCirclePublicKey('22222222-3333-4444-5555-666666666666');

    expect(result).toBeNull();
    expect(fetchCalls).toHaveLength(0);
  });

  test('rejects malformed key id without hitting the network', async () => {
    installFetch(() => new Response('should not be called', { status: 200 }));

    const result = await getCirclePublicKey('not-a-uuid');

    expect(result).toBeNull();
    expect(fetchCalls).toHaveLength(0);
  });

  test('wraps raw base64 response into PEM banners (chunked at 64 chars per RFC 7468)', async () => {
    const rawB64 =
      'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEArandombase64payloadherefortestonly==';
    installFetch(() => Response.json({ data: { publicKey: rawB64 } }));

    const pem = await getCirclePublicKey('33333333-4444-5555-6666-777777777777');

    expect(pem).toContain('-----BEGIN PUBLIC KEY-----');
    expect(pem).toContain('-----END PUBLIC KEY-----');
    // Strip banners + whitespace and confirm the body round-trips to the
    // original raw base64. The wrap chunks at 64 chars per PEM spec, so a
    // direct `toContain(rawB64)` would fail on any payload over 64 chars.
    const body = pem!
      .replace('-----BEGIN PUBLIC KEY-----', '')
      .replace('-----END PUBLIC KEY-----', '')
      .replace(/\s+/g, '');
    expect(body).toBe(rawB64);
  });

  test('passes through pre-wrapped PEM unchanged', async () => {
    const prewrapped = '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG\n-----END PUBLIC KEY-----\n';
    installFetch(() => Response.json({ data: { publicKey: prewrapped } }));

    const pem = await getCirclePublicKey('44444444-5555-6666-7777-888888888888');

    expect(pem).toBe(prewrapped);
  });

  test('returns null on non-200 from Circle', async () => {
    installFetch(
      () => new Response('{"code":2,"message":"API parameter invalid"}', { status: 404 })
    );

    const result = await getCirclePublicKey('55555555-6666-7777-8888-999999999999');

    expect(result).toBeNull();
  });
});

describe('gateCircleWebhook', () => {
  test('rejects with structured ctx when signature header missing', async () => {
    const result = await gateCircleWebhook({
      rawBody: '{}',
      signatureHeader: null,
      keyIdHeader: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      handledTypes: new Set(['transactions.inbound']),
    });

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.status).toBe(401);
      expect(result.body.error).toBe('missing_signature');
    }
  });

  test('rejects with structured ctx when key id is malformed', async () => {
    const result = await gateCircleWebhook({
      rawBody: '{}',
      signatureHeader: 'sig',
      keyIdHeader: 'not-a-uuid',
      handledTypes: new Set(['transactions.inbound']),
    });

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.body.error).toBe('invalid_key_id');
    }
  });
});
