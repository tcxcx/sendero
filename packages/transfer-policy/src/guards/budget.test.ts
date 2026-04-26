import { describe, expect, test } from 'bun:test';

import { BudgetGuard, defaultStartOfWindow, type BudgetStore } from './budget';
import type { PaymentContext } from '../types';

function makeStore(spent: bigint): BudgetStore {
  return {
    spentInWindow: async () => spent,
  };
}

const ctx = (overrides: Partial<PaymentContext> = {}): PaymentContext => ({
  tenantId: 'tnt_test',
  amountMicroUsdc: 1_000_000n,
  kind: 'x402',
  toolName: 'duffel.search',
  travelerId: 'usr_test',
  ...overrides,
});

describe('BudgetGuard', () => {
  test('within ceiling → allowed', async () => {
    const guard = new BudgetGuard({
      period: 'daily',
      capMicroUsdc: 5_000_000n,
      hardCap: true,
      scope: 'tenant',
      store: makeStore(1_000_000n),
    });
    const r = await guard.check(ctx());
    expect(r.allowed).toBe(true);
    expect(r.detail?.remainingMicro).toBe('3000000');
  });

  test('hard cap exceeded → blocked', async () => {
    const guard = new BudgetGuard({
      period: 'daily',
      capMicroUsdc: 1_000_000n,
      hardCap: true,
      scope: 'tenant',
      store: makeStore(900_000n),
    });
    const r = await guard.check(ctx({ amountMicroUsdc: 200_000n }));
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('tenant daily budget exceeded');
  });

  test('soft cap exceeded → allowed but flagged', async () => {
    const guard = new BudgetGuard({
      period: 'monthly',
      capMicroUsdc: 1_000_000n,
      hardCap: false,
      scope: 'tenant',
      store: makeStore(900_000n),
    });
    const r = await guard.check(ctx({ amountMicroUsdc: 200_000n }));
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe('tenant monthly soft cap exceeded');
    expect(r.detail?.softCap).toBe(true);
  });

  test('traveler scope without travelerId → out of scope, allowed', async () => {
    const guard = new BudgetGuard({
      period: 'daily',
      capMicroUsdc: 0n,
      hardCap: true,
      scope: 'traveler',
      store: makeStore(0n),
    });
    const r = await guard.check(ctx({ travelerId: undefined }));
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe('budget guard not in scope');
  });

  test('tool scope without toolName → out of scope, allowed', async () => {
    const guard = new BudgetGuard({
      period: 'daily',
      capMicroUsdc: 0n,
      hardCap: true,
      scope: 'tool',
      store: makeStore(0n),
    });
    const r = await guard.check(ctx({ toolName: undefined }));
    expect(r.allowed).toBe(true);
  });

  test('store gets the right scope tuple', async () => {
    let observed: Parameters<BudgetStore['spentInWindow']>[0] | undefined;
    const guard = new BudgetGuard({
      period: 'weekly',
      capMicroUsdc: 1_000_000_000n,
      hardCap: true,
      scope: 'traveler',
      store: {
        spentInWindow: async args => {
          observed = args;
          return 0n;
        },
      },
    });
    await guard.check(ctx({ travelerId: 'usr_x', toolName: 'tool_a' }));
    expect(observed?.tenantId).toBe('tnt_test');
    expect(observed?.travelerId).toBe('usr_x');
    expect(observed?.toolName).toBeUndefined();
  });

  test('defaultStartOfWindow daily snaps to UTC midnight', () => {
    const at = new Date('2026-04-25T15:32:01Z');
    const start = defaultStartOfWindow('daily', at);
    expect(start.toISOString()).toBe('2026-04-25T00:00:00.000Z');
  });

  test('defaultStartOfWindow weekly is trailing 7 days', () => {
    const at = new Date('2026-04-25T15:32:01Z');
    const start = defaultStartOfWindow('weekly', at);
    expect(start.toISOString()).toBe('2026-04-18T15:32:01.000Z');
  });

  test('defaultStartOfWindow monthly snaps to month start', () => {
    const at = new Date('2026-04-25T15:32:01Z');
    const start = defaultStartOfWindow('monthly', at);
    expect(start.toISOString()).toBe('2026-04-01T00:00:00.000Z');
  });
});
