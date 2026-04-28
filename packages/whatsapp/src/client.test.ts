/**
 * Tests for WhatsAppClient send-retry logic and uploadMedia.
 *
 * Stubs global `fetch` to drive deterministic 5xx / 429 / 200 sequences
 * and assert the request is retried on transient failures and bubbles
 * 4xx / final 5xx without retry.
 *
 * Run: `bun test packages/whatsapp/src/client.test.ts`
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { WhatsAppClient } from './client';

const ORIGINAL_FETCH = globalThis.fetch;

interface FakeResponse {
  status: number;
  body?: unknown;
  retryAfter?: string;
}

function buildResponse(r: FakeResponse): Response {
  const headers = new Headers();
  if (r.retryAfter) headers.set('retry-after', r.retryAfter);
  const body =
    r.body !== undefined ? (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)) : '';
  return new Response(body, { status: r.status, headers });
}

function stubFetch(responses: FakeResponse[]): {
  calls: { url: string; init: RequestInit | undefined }[];
} {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  let i = 0;
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    if (!r) throw new Error('fetch stub exhausted');
    return buildResponse(r);
  };
  return { calls };
}

beforeEach(() => {
  // No-op; per-test stubFetch runs.
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe('WhatsAppClient — request retry', () => {
  test('200 on first attempt: no retries', async () => {
    const { calls } = stubFetch([{ status: 200, body: { messaging_product: 'whatsapp' } }]);
    const client = new WhatsAppClient({ phoneNumberId: 'PNID', accessToken: 'tok' });
    await client.sendText('+1', 'hello');
    expect(calls).toHaveLength(1);
  });

  test('500 then 200: retried once and succeeds', async () => {
    const { calls } = stubFetch([
      { status: 500, body: 'meta is sad' },
      { status: 200, body: {} },
    ]);
    const client = new WhatsAppClient({ phoneNumberId: 'PNID', accessToken: 'tok' });
    await client.sendText('+1', 'hello');
    expect(calls).toHaveLength(2);
  });

  test('429 then 200: retried and succeeds', async () => {
    const { calls } = stubFetch([
      { status: 429, body: 'slow down', retryAfter: '0' },
      { status: 200, body: {} },
    ]);
    const client = new WhatsAppClient({ phoneNumberId: 'PNID', accessToken: 'tok' });
    await client.sendText('+1', 'hello');
    expect(calls).toHaveLength(2);
  });

  test('400 bad request: NO retry, throws immediately', async () => {
    const { calls } = stubFetch([
      { status: 400, body: 'bad template' },
      { status: 200, body: {} },
    ]);
    const client = new WhatsAppClient({ phoneNumberId: 'PNID', accessToken: 'tok' });
    await expect(client.sendText('+1', 'hello')).rejects.toThrow(/400/);
    expect(calls).toHaveLength(1);
  });

  test('three consecutive 500s: gives up after 3 attempts', async () => {
    const { calls } = stubFetch([
      { status: 500, body: 'x' },
      { status: 500, body: 'x' },
      { status: 500, body: 'x' },
    ]);
    const client = new WhatsAppClient({ phoneNumberId: 'PNID', accessToken: 'tok' });
    await expect(client.sendText('+1', 'hello')).rejects.toThrow(/500/);
    expect(calls).toHaveLength(3);
  });
});

describe('WhatsAppClient — uploadMedia', () => {
  test('returns mediaId on 200', async () => {
    const { calls } = stubFetch([{ status: 200, body: { id: '1234567890' } }]);
    const client = new WhatsAppClient({ phoneNumberId: 'PNID', accessToken: 'tok' });
    const result = await client.uploadMedia({
      data: new Uint8Array([1, 2, 3, 4]),
      mimeType: 'image/jpeg',
      filename: 'pic.jpg',
    });
    expect(result.mediaId).toBe('1234567890');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain('/PNID/media');
    // FormData is the body — Content-Type is set automatically by fetch
    // when it sees a FormData body, including the multipart boundary.
    expect(calls[0]!.init?.method).toBe('POST');
  });

  test('throws on missing id in response', async () => {
    stubFetch([{ status: 200, body: {} }]);
    const client = new WhatsAppClient({ phoneNumberId: 'PNID', accessToken: 'tok' });
    await expect(
      client.uploadMedia({
        data: new Uint8Array([1]),
        mimeType: 'image/jpeg',
      })
    ).rejects.toThrow(/no id/);
  });

  test('throws on non-200', async () => {
    stubFetch([{ status: 400, body: 'invalid mime' }]);
    const client = new WhatsAppClient({ phoneNumberId: 'PNID', accessToken: 'tok' });
    await expect(
      client.uploadMedia({
        data: new Uint8Array([1]),
        mimeType: 'image/jpeg',
      })
    ).rejects.toThrow(/400/);
  });
});
