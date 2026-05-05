import { describe, expect, test } from 'bun:test';
import { resolveEsimGoMode, resolveEsimProvider } from './pricing';

describe('resolveEsimProvider — env routing', () => {
  test("ESIM_PROVIDER='mock' forces mock even when ESIM_GO_API_KEY is set", () => {
    const p = resolveEsimProvider({
      ESIM_PROVIDER: 'mock',
      ESIM_GO_API_KEY: 'whatever',
    });
    expect(p.slug).toBe('mock');
  });

  test('ESIM_GO_API_KEY → eSIM Go provider', () => {
    const p = resolveEsimProvider({ ESIM_GO_API_KEY: 'k' });
    expect(p.slug).toBe('esim-go');
  });

  test('no env → mock with warning (dev convenience)', () => {
    const p = resolveEsimProvider({});
    expect(p.slug).toBe('mock');
  });

  test('NODE_ENV=production with no ESIM_GO_API_KEY still falls back to mock + warns', () => {
    const p = resolveEsimProvider({ NODE_ENV: 'production' });
    expect(p.slug).toBe('mock');
  });
});

describe('resolveEsimGoMode — validate vs transaction default', () => {
  test('VERCEL_ENV=production → transaction', () => {
    expect(resolveEsimGoMode({ VERCEL_ENV: 'production' })).toBe('transaction');
  });

  test('NODE_ENV=production → transaction', () => {
    expect(resolveEsimGoMode({ NODE_ENV: 'production' })).toBe('transaction');
  });

  test('VERCEL_ENV=preview → validate (no balance burn behind ngrok)', () => {
    expect(resolveEsimGoMode({ VERCEL_ENV: 'preview' })).toBe('validate');
  });

  test('VERCEL_ENV=development → validate', () => {
    expect(resolveEsimGoMode({ VERCEL_ENV: 'development' })).toBe('validate');
  });

  test('local (no env) → validate', () => {
    expect(resolveEsimGoMode({})).toBe('validate');
  });

  test("explicit ESIM_GO_MODE='transaction' overrides production-default flip", () => {
    expect(resolveEsimGoMode({ VERCEL_ENV: 'preview', ESIM_GO_MODE: 'transaction' })).toBe(
      'transaction'
    );
  });

  test("explicit ESIM_GO_MODE='transaction' is honored in non-production envs", () => {
    expect(resolveEsimGoMode({ VERCEL_ENV: 'preview', ESIM_GO_MODE: 'transaction' })).toBe(
      'transaction'
    );
  });

  test('unknown ESIM_GO_MODE value falls through to env-default', () => {
    expect(resolveEsimGoMode({ VERCEL_ENV: 'preview', ESIM_GO_MODE: 'something' })).toBe(
      'validate'
    );
  });

  test('PRODUCTION GUARD: explicit ESIM_GO_MODE=validate in production is rejected', () => {
    // Validate mode tolerates eSIM Go `valid:false` (often = "balance < subTotal")
    // and mints synthetic LPAs. Allowing it in production would silently fake
    // real orders. Resolver must force `transaction` regardless.
    expect(
      resolveEsimGoMode({ VERCEL_ENV: 'production', ESIM_GO_MODE: 'validate' })
    ).toBe('transaction');
    expect(
      resolveEsimGoMode({ NODE_ENV: 'production', ESIM_GO_MODE: 'validate' })
    ).toBe('transaction');
  });
});
