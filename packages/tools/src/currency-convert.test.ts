/**
 * currency_convert unit tests.
 *
 * Stubs `fetch` to keep the suite hermetic — Frankfurter is reachable
 * from CI but we don't want flake or rate dependencies.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { _resetCurrencyCache, currencyConvert, currencyConvertTool } from './currency-convert';

const realFetch = globalThis.fetch;

function mockFetch(impl: typeof fetch): void {
  globalThis.fetch = impl;
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

beforeEach(() => {
  _resetCurrencyCache();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('currency_convert', () => {
  test('converts USD → EUR via Frankfurter', async () => {
    let calls = 0;
    mockFetch(async () => {
      calls += 1;
      return jsonResponse({
        amount: 1,
        base: 'USD',
        date: '2026-05-04',
        rates: { EUR: 0.92 },
      });
    });

    const out = await currencyConvert({ amount: 100, from: 'USD', to: 'EUR' });

    expect(out.converted).toBe(92);
    expect(out.rate).toBe(0.92);
    expect(out.rateDate).toBe('2026-05-04');
    expect(out.source).toBe('frankfurter-ecb');
    expect(out.identity).toBe(false);
    expect(calls).toBe(1);
  });

  test('identity (from === to) returns amount unchanged with rate=1, no fetch', async () => {
    let calls = 0;
    mockFetch(async () => {
      calls += 1;
      return jsonResponse({});
    });

    const out = await currencyConvert({ amount: 50, from: 'USD', to: 'USD' });

    expect(out.converted).toBe(50);
    expect(out.rate).toBe(1);
    expect(out.identity).toBe(true);
    expect(calls).toBe(0);
  });

  test('caches rate for repeated calls within TTL (single fetch for two calls)', async () => {
    let calls = 0;
    mockFetch(async () => {
      calls += 1;
      return jsonResponse({
        amount: 1,
        base: 'GBP',
        date: '2026-05-04',
        rates: { JPY: 195.4 },
      });
    });

    await currencyConvert({ amount: 10, from: 'GBP', to: 'JPY' });
    await currencyConvert({ amount: 25, from: 'GBP', to: 'JPY' });

    expect(calls).toBe(1);
  });

  test('respects asOf for historical rate (separate cache key)', async () => {
    let calls = 0;
    mockFetch(async req => {
      calls += 1;
      const url = typeof req === 'string' ? req : (req as Request).url;
      // Echo the date the caller asked for.
      const asOf = url.includes('/2026-01-01') ? '2026-01-01' : '2026-05-04';
      return jsonResponse({
        amount: 1,
        base: 'USD',
        date: asOf,
        rates: { EUR: asOf === '2026-01-01' ? 0.9 : 0.92 },
      });
    });

    const latest = await currencyConvert({ amount: 100, from: 'USD', to: 'EUR' });
    const historical = await currencyConvert({
      amount: 100,
      from: 'USD',
      to: 'EUR',
      asOf: '2026-01-01',
    });

    expect(latest.rate).toBe(0.92);
    expect(historical.rate).toBe(0.9);
    expect(historical.rateDate).toBe('2026-01-01');
    expect(calls).toBe(2);
  });

  test('throws on non-200 from Frankfurter', async () => {
    mockFetch(async () => new Response('boom', { status: 502, statusText: 'Bad Gateway' }));

    await expect(currencyConvert({ amount: 10, from: 'USD', to: 'EUR' })).rejects.toThrow(
      /Frankfurter API 502/
    );
  });

  test('throws when target currency missing from response', async () => {
    mockFetch(async () => jsonResponse({ amount: 1, base: 'USD', date: '2026-05-04', rates: {} }));

    await expect(currencyConvert({ amount: 10, from: 'USD', to: 'XYZ' })).rejects.toThrow(
      /no rate returned/
    );
  });

  test('zod schema rejects malformed currency code', () => {
    const result = currencyConvertTool.inputSchema.safeParse({
      amount: 10,
      from: 'us',
      to: 'EUR',
    });
    expect(result.success).toBe(false);
  });

  test('zod schema rejects negative amount', () => {
    const result = currencyConvertTool.inputSchema.safeParse({
      amount: -1,
      from: 'USD',
      to: 'EUR',
    });
    expect(result.success).toBe(false);
  });

  test('rounds to 2 decimal places', async () => {
    mockFetch(async () =>
      jsonResponse({ amount: 1, base: 'USD', date: '2026-05-04', rates: { EUR: 0.92345 } })
    );

    const out = await currencyConvert({ amount: 33.33, from: 'USD', to: 'EUR' });
    expect(out.converted).toBe(30.78);
  });
});
