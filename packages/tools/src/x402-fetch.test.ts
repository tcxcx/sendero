/**
 * x402-fetch — gate + happy-path tests.
 *
 * Tests the pure helpers via the `__test__` export, plus one
 * end-to-end happy path with `fetch`, viem, and Prisma mocked.
 * Live x402 settlement is not exercised in CI — see
 * `bun apps/app/scripts/_local/x402-smoke.ts` for the manual smoke.
 */

import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

// ── Mocks ───────────────────────────────────────────────────────────
//
// `@sendero/database` is mocked at the module level (no other test
// file imports it via `./x402-fetch`'s path so this is collision-safe).
// `viem.readContract` is intercepted via the helper's __test__ seam
// because mock.module('viem') gets shadowed by sibling test files
// that load before this one (track-flight, external-data-tools).

const findManyMock = mock(async () => [] as Array<unknown>);
const createMeterMock = mock(async () => ({ id: 'meter_test_001' }));

mock.module('@sendero/database', () => ({
  prisma: {
    meterEvent: {
      findMany: findManyMock,
      create: createMeterMock,
    },
  },
}));

// ── Set up env, then import the helper ──────────────────────────────

const TEST_PRIVATE_KEY = generatePrivateKey();
const TEST_ACCOUNT = privateKeyToAccount(TEST_PRIVATE_KEY);

beforeAll(() => {
  process.env.TREASURY_PRIVATE_KEY = TEST_PRIVATE_KEY;
  process.env.X402_OUTBOUND_ALLOWLIST = 'stabletravel.dev,tripadvisor.x402.paysponge.com';
});

afterAll(() => {
  delete process.env.TREASURY_PRIVATE_KEY;
  delete process.env.X402_OUTBOUND_ALLOWLIST;
});

const { x402Fetch, X402Error, __test__ } = await import('./x402-fetch');

let mockBalance = 0n;
__test__.setReadBalance(async () => mockBalance);

// ── Pure helpers ────────────────────────────────────────────────────

describe('isHostAllowlisted', () => {
  test('exact match', () => {
    expect(__test__.isHostAllowlisted(new URL('https://stabletravel.dev/foo'))).toBe(true);
  });
  test('subdomain match', () => {
    expect(__test__.isHostAllowlisted(new URL('https://api.stabletravel.dev/foo'))).toBe(true);
  });
  test('rejects unknown host', () => {
    expect(__test__.isHostAllowlisted(new URL('https://attacker.example.com/'))).toBe(false);
  });
  test('rejects host containing allowlisted as substring', () => {
    expect(__test__.isHostAllowlisted(new URL('https://stabletravel.dev.attacker.com/'))).toBe(false);
  });
});

describe('pickBaseMainnetScheme', () => {
  test('selects eip155:8453 USDC scheme', () => {
    const accept = {
      scheme: 'exact',
      network: 'eip155:8453',
      asset: __test__.BASE_USDC,
      amount: '10000',
      payTo: '0xDd257723b86B4947483905cdAcBbBC70fACF2ec0' as const,
      maxTimeoutSeconds: 300,
    };
    const picked = __test__.pickBaseMainnetScheme({
      x402Version: 2,
      accepts: [
        { ...accept, network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' },
        accept,
      ],
    });
    expect(picked.network).toBe('eip155:8453');
  });

  test('throws when no Base mainnet scheme available', () => {
    expect(() =>
      __test__.pickBaseMainnetScheme({
        x402Version: 2,
        accepts: [
          {
            scheme: 'exact',
            network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
            asset: '0x0000000000000000000000000000000000000000',
            amount: '10000',
            payTo: '0xDd257723b86B4947483905cdAcBbBC70fACF2ec0',
            maxTimeoutSeconds: 300,
          },
        ],
      })
    ).toThrow(/no_eip155_8453_scheme|does not accept Base/);
  });

  test('rejects scheme with mismatched USDC asset', () => {
    expect(() =>
      __test__.pickBaseMainnetScheme({
        x402Version: 2,
        accepts: [
          {
            scheme: 'exact',
            network: 'eip155:8453',
            asset: '0x0000000000000000000000000000000000000001', // not USDC
            amount: '10000',
            payTo: '0xDd257723b86B4947483905cdAcBbBC70fACF2ec0',
            maxTimeoutSeconds: 300,
          },
        ],
      })
    ).toThrow(/does not accept Base/);
  });
});

describe('buildPaymentHeader', () => {
  test('encodes payload as base64 JSON', () => {
    const accept = {
      scheme: 'exact',
      network: 'eip155:8453',
      asset: __test__.BASE_USDC,
      amount: '10000',
      payTo: '0xDd257723b86B4947483905cdAcBbBC70fACF2ec0' as const,
      maxTimeoutSeconds: 300,
    };
    const signed = {
      signature: '0xabc' as const,
      authorization: {
        from: TEST_ACCOUNT.address,
        to: accept.payTo,
        value: '10000',
        validAfter: '0',
        validBefore: '999999',
        nonce: '0xdeadbeef' as const,
      },
    };
    const header = __test__.buildPaymentHeader(accept, signed);
    const decoded = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
    expect(decoded.x402Version).toBe(2);
    expect(decoded.scheme).toBe('exact');
    expect(decoded.network).toBe('eip155:8453');
    expect(decoded.payload.signature).toBe('0xabc');
  });
});

// ── Gates ───────────────────────────────────────────────────────────

describe('x402Fetch gates', () => {
  test('rejects sandbox keys', async () => {
    await expect(
      x402Fetch('https://stabletravel.dev/api/foo', {
        toolName: 'track_flight',
        ctx: {
          caller: { effectiveKeyType: 'sandbox' },
          traveler: { tenantId: 'org_test' },
        },
      })
    ).rejects.toMatchObject({ code: 'sandbox_blocked' });
  });

  test('allows undefined caller (operator console, shared-secret webhooks)', async () => {
    // No caller → trusted internal surface (Slack agent in-process,
    // /api/agent/dispatch shared-secret, /api/tools/[name] shared-secret,
    // operator console). Should clear the spend gate, then fail at the
    // *next* gate (allowlist) since we used a non-allowlisted host.
    await expect(
      x402Fetch('https://attacker.example.com/api/foo', {
        toolName: 'track_flight',
        ctx: { traveler: { tenantId: 'org_test' } },
      })
    ).rejects.toMatchObject({ code: 'host_not_allowlisted' });
  });

  test('rejects when tenant context missing', async () => {
    await expect(
      x402Fetch('https://stabletravel.dev/api/foo', {
        toolName: 'track_flight',
        ctx: { caller: { effectiveKeyType: 'production' } },
      })
    ).rejects.toMatchObject({ code: 'tenant_required' });
  });

  test('rejects unknown host', async () => {
    await expect(
      x402Fetch('https://attacker.example.com/api/foo', {
        toolName: 'track_flight',
        ctx: {
          caller: { effectiveKeyType: 'production' },
          traveler: { tenantId: 'org_test' },
        },
      })
    ).rejects.toMatchObject({ code: 'host_not_allowlisted' });
  });
});

// ── Happy path ──────────────────────────────────────────────────────

describe('x402Fetch happy path', () => {
  const fetchMock = mock();
  const originalFetch = globalThis.fetch;

  beforeAll(() => {
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    // Treasury has 1 USDC on Base — plenty for a $0.01 call.
    mockBalance = 1_000_000n;
    findManyMock.mockImplementation(async () => []);
    createMeterMock.mockImplementation(async () => ({ id: 'meter_test_001' }));
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  test('signs payment and retries with X-PAYMENT header', async () => {
    const paymentRequiredBody = {
      x402Version: 2,
      accepts: [
        {
          scheme: 'exact',
          network: 'eip155:8453',
          asset: __test__.BASE_USDC,
          amount: '10000',
          payTo: '0xDd257723b86B4947483905cdAcBbBC70fACF2ec0',
          maxTimeoutSeconds: 300,
        },
      ],
    };

    fetchMock.mockImplementationOnce(
      async () =>
        new Response(JSON.stringify(paymentRequiredBody), {
          status: 402,
          headers: { 'content-type': 'application/json' },
        })
    );
    fetchMock.mockImplementationOnce(
      async (_url: string, init?: RequestInit) => {
        const headers = init?.headers as Record<string, string>;
        // Assertion: the retry MUST carry X-PAYMENT
        expect(headers['X-PAYMENT']).toBeDefined();
        return new Response(JSON.stringify({ flights: [{ ident: 'AAL100', status: 'On Time' }] }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'x-settlement-tx': '0xfeedface',
          },
        });
      }
    );

    const result = await x402Fetch<{ flights: unknown[] }>(
      'https://stabletravel.dev/api/flightaware/flights/AAL100',
      {
        toolName: 'track_flight',
        ctx: {
          caller: { effectiveKeyType: 'production' },
          traveler: { tenantId: 'org_test', userId: 'usr_1' },
        },
      }
    );

    expect(result.data.flights).toHaveLength(1);
    expect(result.meta.paidMicroUsdc).toBe(10000n);
    expect(result.meta.settlementHash).toBe('0xfeedface');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('rejects when treasury balance below required amount', async () => {
    mockBalance = 100n; // way too low

    fetchMock.mockImplementationOnce(
      async () =>
        new Response(
          JSON.stringify({
            x402Version: 2,
            accepts: [
              {
                scheme: 'exact',
                network: 'eip155:8453',
                asset: __test__.BASE_USDC,
                amount: '10000',
                payTo: '0xDd257723b86B4947483905cdAcBbBC70fACF2ec0',
                maxTimeoutSeconds: 300,
              },
            ],
          }),
          { status: 402, headers: { 'content-type': 'application/json' } }
        )
    );

    await expect(
      x402Fetch('https://stabletravel.dev/api/flightaware/flights/AAL100', {
        toolName: 'track_flight',
        ctx: {
          caller: { effectiveKeyType: 'production' },
          traveler: { tenantId: 'org_test' },
        },
      })
    ).rejects.toMatchObject({ code: 'treasury_balance_low' });
  });

  test('rejects when per-tenant 24h cap would be exceeded', async () => {
    mockBalance = 1_000_000n;
    // $1.00 already spent in 24h; another $0.01 puts it over $1.00.
    findManyMock.mockImplementation(async () => [
      { priceMicroUsdc: 999_995n, metadata: { kind: 'x402_outbound' } },
    ]);

    fetchMock.mockImplementationOnce(
      async () =>
        new Response(
          JSON.stringify({
            x402Version: 2,
            accepts: [
              {
                scheme: 'exact',
                network: 'eip155:8453',
                asset: __test__.BASE_USDC,
                amount: '10000',
                payTo: '0xDd257723b86B4947483905cdAcBbBC70fACF2ec0',
                maxTimeoutSeconds: 300,
              },
            ],
          }),
          { status: 402, headers: { 'content-type': 'application/json' } }
        )
    );

    await expect(
      x402Fetch('https://stabletravel.dev/api/flightaware/flights/AAL100', {
        toolName: 'track_flight',
        ctx: {
          caller: { effectiveKeyType: 'production' },
          traveler: { tenantId: 'org_test' },
        },
      })
    ).rejects.toMatchObject({ code: 'per_tenant_cap' });
  });

  test('throws X402Error rather than generic Error', async () => {
    try {
      await x402Fetch('https://attacker.example.com/x', {
        toolName: 'track_flight',
        ctx: {
          caller: { effectiveKeyType: 'production' },
          traveler: { tenantId: 'org_test' },
        },
      });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(X402Error);
      expect((err as { code: string }).code).toBe('host_not_allowlisted');
    }
  });
});
