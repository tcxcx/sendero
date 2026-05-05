import { describe, expect, test, mock, beforeEach, beforeAll, afterAll } from 'bun:test';

// Mock @sendero/database BEFORE importing the unit under test. We
// pass through the real module's named exports (Prisma, MeterPayerType,
// etc.) so other test files importing them don't break when bun runs
// everything in a shared module graph — only `prisma` is stubbed.
const findPolicy = mock(async (_args: unknown) => null as unknown);
const upsertEsim = mock(async (args: { create: Record<string, unknown> }) => ({
  id: 'esim_test_001',
  ...(args.create as object),
}));
const createMeter = mock(async () => ({ id: 'meter_test_001' }));
const findUniqueTrip = mock(async () => null as unknown);
const findUniqueTenant = mock(async () => ({ defaultPaymentMode: 'traveler' as const }));

const realDb = await import('@sendero/database');
mock.module('@sendero/database', () => ({
  ...realDb,
  prisma: {
    tenantPricingPolicy: { findFirst: findPolicy },
    esim: { upsert: upsertEsim },
    meterEvent: { create: createMeter },
    trip: { findUnique: findUniqueTrip },
    tenant: { findUnique: findUniqueTenant },
  },
}));

// Force the mock provider so the package side stays deterministic.
// `process.env` mutations are scoped via beforeAll/afterAll because
// bun-test sometimes shares workers across files — left-over env from
// this file would otherwise drift snapshots in the channel-render tests
// (which assert on whether buildShareImageUrl returns a signed URL or
// null, gated on INVOICE_SIGNING_SECRET).
const ENV_KEYS = ['ESIM_PROVIDER', 'INVOICE_SIGNING_SECRET'] as const;
const ENV_BEFORE: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const k of ENV_KEYS) ENV_BEFORE[k] = process.env[k];
  process.env.ESIM_PROVIDER = 'mock';
  process.env.INVOICE_SIGNING_SECRET = 'test_secret';
});
afterAll(() => {
  for (const k of ENV_KEYS) {
    if (ENV_BEFORE[k] === undefined) delete process.env[k];
    else process.env[k] = ENV_BEFORE[k];
  }
});

const { bookEsim } = await import('./book-esim');

beforeEach(() => {
  findPolicy.mockClear();
  upsertEsim.mockClear();
  createMeter.mockClear();
  findUniqueTrip.mockClear();
  findUniqueTenant.mockClear();
});

const baseCtx = {
  traveler: { tenantId: 'ten_test', userId: 'usr_alice' },
  payer: { type: 'traveler' as const, travelerUserId: 'usr_alice' },
};

describe('book_esim — happy path', () => {
  test('quotes mock plan, applies 0bps default markup + Sendero take, persists, meters', async () => {
    const out = await bookEsim(
      { destinationIso2: ['JP'], days: 7, dataGb: 5, planTier: 'free' },
      baseCtx
    );
    expect(out.status).toBe('ok');
    expect(out.esimId).toBe('esim_test_001');
    expect(out.lpaCode).toStartWith('LPA:1$smdp.mock.sendero.dev$');

    // Pricing — mock single-country quote is $0.50/GB × 5GB = $2.50 wholesale.
    expect(out.pricing!.wholesaleMicroUsdc).toBe('2500000');
    // Default markup = 0bps when tenant hasn't configured esim policy.
    expect(out.pricing!.markupMicroUsdc).toBe('0');
    // Sendero take floor ($0.50) binds because 50bps × $2.50 = $0.0125 < $0.50.
    expect(out.pricing!.senderoTakeMicroUsdc).toBe('500000');
    // Retail = wholesale + markup + take = $3.00 (add_to_customer default).
    expect(out.pricing!.retailMicroUsdc).toBe('3000000');

    // Persistence — Esim row carries payer attribution.
    expect(upsertEsim).toHaveBeenCalledTimes(1);
    const created = (upsertEsim.mock.calls[0]![0] as { create: Record<string, unknown> }).create;
    expect(created.tenantId).toBe('ten_test');
    expect(created.travelerId).toBe('usr_alice');
    expect(created.provider).toBe('mock');
    expect(created.provisionedBy).toBe('traveler');
    expect(created.payerUserId).toBe('usr_alice');

    // MeterEvent — payer fields stamped, status='paid'.
    expect(createMeter).toHaveBeenCalledTimes(1);
    const meterArgs = (createMeter.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(meterArgs.toolName).toBe('book_esim');
    expect(meterArgs.payerType).toBe('traveler');
    expect(meterArgs.payerUserId).toBe('usr_alice');
    expect(meterArgs.priceMicroUsdc).toBe(500_000n);
  });

  test('share payload carries human-readable price + payer attribution', async () => {
    const out = await bookEsim(
      { destinationIso2: ['JP'], days: 7, dataGb: 5, planTier: 'free' },
      baseCtx
    );
    expect(out.share!.title).toBe('Trip eSIM ready');
    expect(out.share!.bullets.some(b => b.includes('charged to your wallet'))).toBe(true);
  });

  test('signed QR url includes esimId + signature', async () => {
    const out = await bookEsim(
      { destinationIso2: ['JP'], days: 7, dataGb: 5, planTier: 'free' },
      baseCtx
    );
    expect(out.qrTokenUrl).toMatch(/\/api\/esim\/qr\/.+\..+\.png$/);
  });
});

describe('book_esim — payer override', () => {
  test('explicit provisionedBy=tenant overrides ctx.payer', async () => {
    const out = await bookEsim(
      {
        destinationIso2: ['JP'],
        days: 7,
        dataGb: 5,
        planTier: 'free',
        provisionedBy: 'tenant',
      },
      baseCtx
    );
    expect(out.status).toBe('ok');
    const created = (upsertEsim.mock.calls.at(-1)![0] as { create: Record<string, unknown> })
      .create;
    expect(created.provisionedBy).toBe('tenant');
  });
});

describe('book_esim — tenant markup config', () => {
  test('tenant esim policy markup applied on top of wholesale', async () => {
    findPolicy.mockImplementationOnce(async () => ({
      version: 3,
      markupConfig: { esim: { strategy: 'static', bps: 5_000 } }, // 50%
      floorMicroUsdc: 1_000_000n,
      ceilingMicroUsdc: null,
      senderoTakeBehavior: 'add_to_customer',
    }));
    const out = await bookEsim(
      { destinationIso2: ['JP'], days: 7, dataGb: 5, planTier: 'free' },
      baseCtx
    );
    expect(out.pricing!.markupMicroUsdc).toBe('1250000'); // 50% of $2.50 = $1.25
  });
});

describe('book_esim — error paths', () => {
  test('no tenant in ctx → provider_error', async () => {
    const out = await bookEsim({ destinationIso2: ['JP'], days: 7, dataGb: 5 }, undefined);
    expect(out.status).toBe('provider_error');
    expect(out.message).toContain('tenant-bound caller');
  });

  test('empty destinations → no_plan_found from provider', async () => {
    // The Zod input schema rejects empty arrays at the tool adapter,
    // but the underlying `bookEsim` function still handles the case
    // gracefully when the provider returns null (defense-in-depth for
    // future providers that may return null on legitimate misses).
    const out = await bookEsim({ destinationIso2: [], days: 7, dataGb: 5 } as never, baseCtx);
    expect(out.status).toBe('no_plan_found');
  });
});
