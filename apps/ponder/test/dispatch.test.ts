/**
 * Unit tests for the indexer→app dispatch helpers.
 *
 * Covers the two contracts the Ponder handlers depend on:
 *   - secret guard: missing INDEXER_DISPATCH_SECRET returns a typed
 *     `{ ok: false, error }` instead of throwing
 *   - HTTP shape: bearer auth, JSON body, target path
 *   - non-2xx: surfaces status + truncated body
 *   - timeout: AbortController triggers and the helper returns ok: false
 *
 * The handler-side wiring (`SenderoGuestEscrow:ClaimLockoutTriggered`)
 * is exercised by Ponder's own integration harness once a v3 deploy
 * is on a fork; this file covers the pure helper.
 */

import {
  dispatchBookingSettledV1,
  dispatchBookingSettledV2,
  dispatchClaimLockout,
} from '../src/dispatch';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_SECRET = process.env.INDEXER_DISPATCH_SECRET;
const ORIGINAL_AGENT_SECRET = process.env.AGENT_DISPATCH_SECRET;
const ORIGINAL_ORIGIN = process.env.SENDERO_APP_ORIGIN;

interface FetchCall {
  url: string;
  init: RequestInit;
}

function installFetchMock(handler: (call: FetchCall) => Response | Promise<Response>) {
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const call = { url, init: init ?? {} };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  return calls;
}

beforeEach(() => {
  process.env.INDEXER_DISPATCH_SECRET = 'test-secret';
  process.env.SENDERO_APP_ORIGIN = 'https://app.test.local';
  delete process.env.AGENT_DISPATCH_SECRET;
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_SECRET === undefined) delete process.env.INDEXER_DISPATCH_SECRET;
  else process.env.INDEXER_DISPATCH_SECRET = ORIGINAL_SECRET;
  if (ORIGINAL_AGENT_SECRET === undefined) delete process.env.AGENT_DISPATCH_SECRET;
  else process.env.AGENT_DISPATCH_SECRET = ORIGINAL_AGENT_SECRET;
  if (ORIGINAL_ORIGIN === undefined) delete process.env.SENDERO_APP_ORIGIN;
  else process.env.SENDERO_APP_ORIGIN = ORIGINAL_ORIGIN;
});

describe('dispatchClaimLockout', () => {
  it('returns a typed failure when no secret is configured', async () => {
    delete process.env.INDEXER_DISPATCH_SECRET;
    delete process.env.AGENT_DISPATCH_SECRET;
    const calls = installFetchMock(() => new Response('', { status: 200 }));

    const out = await dispatchClaimLockout({
      tripId: `0x${'11'.repeat(32)}` as `0x${string}`,
      lockedUntil: '1800000000',
      txHash: `0x${'aa'.repeat(32)}` as `0x${string}`,
      blockNumber: '12345',
    });

    expect(out.ok).toBe(false);
    expect(calls.length).toBe(0);
    if (!out.ok) expect(out.error).toContain('no_dispatch_secret');
  });

  it('POSTs to the app endpoint with bearer auth + JSON body', async () => {
    const calls = installFetchMock(() => new Response('{"ok":true}', { status: 200 }));

    const out = await dispatchClaimLockout({
      tripId: `0x${'11'.repeat(32)}` as `0x${string}`,
      lockedUntil: '1800000000',
      txHash: `0x${'aa'.repeat(32)}` as `0x${string}`,
      blockNumber: '12345',
    });

    expect(out.ok).toBe(true);
    expect(calls.length).toBe(1);
    expect(calls[0]!.url).toBe('https://app.test.local/api/internal/security-alerts/claim-lockout');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer test-secret');
    expect(headers['content-type']).toBe('application/json');
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.tripId).toBe(`0x${'11'.repeat(32)}`);
    expect(body.lockedUntil).toBe('1800000000');
  });

  it('falls back to AGENT_DISPATCH_SECRET when INDEXER_DISPATCH_SECRET is unset', async () => {
    delete process.env.INDEXER_DISPATCH_SECRET;
    process.env.AGENT_DISPATCH_SECRET = 'agent-secret';
    const calls = installFetchMock(() => new Response('', { status: 204 }));

    await dispatchClaimLockout({
      tripId: `0x${'11'.repeat(32)}` as `0x${string}`,
      lockedUntil: '0',
      txHash: `0x${'aa'.repeat(32)}` as `0x${string}`,
      blockNumber: '0',
    });

    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe(
      'Bearer agent-secret'
    );
  });

  it('surfaces non-2xx status with truncated body', async () => {
    installFetchMock(() => new Response('upstream exploded'.repeat(50), { status: 502 }));

    const out = await dispatchClaimLockout({
      tripId: `0x${'11'.repeat(32)}` as `0x${string}`,
      lockedUntil: '0',
      txHash: `0x${'aa'.repeat(32)}` as `0x${string}`,
      blockNumber: '0',
    });

    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.status).toBe(502);
      expect(out.error).toContain('non_2xx:502');
      // truncated to ~200 chars
      expect(out.error.length).toBeLessThan(260);
    }
  });

  it('returns ok: false when the request times out', async () => {
    installFetchMock(
      () =>
        new Promise<Response>((_, reject) => {
          // Never resolve normally; abort signal will reject the promise.
          setTimeout(() => reject(new Error('aborted')), 50);
        })
    );

    const out = await dispatchClaimLockout(
      {
        tripId: `0x${'11'.repeat(32)}` as `0x${string}`,
        lockedUntil: '0',
        txHash: `0x${'aa'.repeat(32)}` as `0x${string}`,
        blockNumber: '0',
      },
      { timeoutMs: 10 }
    );

    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.length).toBeGreaterThan(0);
  });
});

describe('dispatchBookingSettledV2', () => {
  it('POSTs the v2 settlement payload to the billing endpoint', async () => {
    const calls = installFetchMock(() => new Response('', { status: 200 }));

    await dispatchBookingSettledV2({
      bookingId: `0x${'22'.repeat(32)}` as `0x${string}`,
      vendor: `0x${'33'.repeat(20)}` as `0x${string}`,
      vendorAmount: '1000000',
      agencyAddress: `0x${'44'.repeat(20)}` as `0x${string}`,
      agencyAmount: '50000',
      feeAmount: '10000',
      txHash: `0x${'aa'.repeat(32)}` as `0x${string}`,
      blockNumber: '99',
    });

    expect(calls[0]!.url).toBe('https://app.test.local/api/internal/billing/settlement-v2');
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.eventVersion).toBe('v2');
    expect(body.agencyAmount).toBe('50000');
    expect(body.feeAmount).toBe('10000');
  });
});

describe('dispatchBookingSettledV1', () => {
  it('POSTs the legacy settlement payload to the same app persister', async () => {
    const calls = installFetchMock(() => new Response('', { status: 200 }));

    await dispatchBookingSettledV1({
      bookingId: `0x${'55'.repeat(32)}` as `0x${string}`,
      vendor: `0x${'66'.repeat(20)}` as `0x${string}`,
      vendorAmount: '1000000',
      feeAmount: '10000',
      txHash: `0x${'bb'.repeat(32)}` as `0x${string}`,
      blockNumber: '100',
    });

    expect(calls[0]!.url).toBe('https://app.test.local/api/internal/billing/settlement-v2');
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.eventVersion).toBe('v1');
    expect(body.vendorAmount).toBe('1000000');
    expect(body.agencyAmount).toBeUndefined();
    expect(body.feeAmount).toBe('10000');
  });
});
