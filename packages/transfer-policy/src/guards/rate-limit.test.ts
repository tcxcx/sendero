import { describe, expect, test } from 'bun:test';

import { RateLimitGuard, type RateLimitStore } from './rate-limit';

const ctx = (overrides: Record<string, unknown> = {}) => ({
  tenantId: 'tnt_test',
  amountMicroUsdc: 1_000n,
  kind: 'x402' as const,
  toolName: 'duffel.search',
  travelerId: 'usr_test',
  ...overrides,
});

function makeStore(count: number): RateLimitStore {
  return {
    countInWindow: async () => count,
  };
}

describe('RateLimitGuard', () => {
  test('count + 1 ≤ max → allowed', async () => {
    const guard = new RateLimitGuard({
      maxCount: 5,
      windowMs: 60_000,
      scope: 'tenant',
      store: makeStore(3),
    });
    const r = await guard.check(ctx());
    expect(r.allowed).toBe(true);
    expect(r.detail?.observedCount).toBe(3);
  });

  test('count + 1 > max → blocked', async () => {
    const guard = new RateLimitGuard({
      maxCount: 5,
      windowMs: 60_000,
      scope: 'tenant',
      store: makeStore(5),
    });
    const r = await guard.check(ctx());
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('tenant rate limit exceeded');
  });

  test('traveler scope without travelerId → out of scope', async () => {
    const guard = new RateLimitGuard({
      maxCount: 0,
      windowMs: 60_000,
      scope: 'traveler',
      store: makeStore(0),
    });
    const r = await guard.check(ctx({ travelerId: undefined }));
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe('rate-limit guard not in scope');
  });

  test('window starts at at - windowMs', async () => {
    let observed: Date | undefined;
    const guard = new RateLimitGuard({
      maxCount: 10,
      windowMs: 60_000,
      scope: 'tenant',
      store: {
        countInWindow: async args => {
          observed = args.windowStartedAt;
          return 0;
        },
      },
    });
    const at = new Date('2026-04-25T15:00:00Z');
    await guard.check(ctx({ at }));
    expect(observed?.toISOString()).toBe('2026-04-25T14:59:00.000Z');
  });
});
