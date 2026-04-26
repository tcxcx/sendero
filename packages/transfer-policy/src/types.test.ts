import { describe, expect, test } from 'bun:test';

import { PolicyChain } from './types';
import type { PaymentContext, PolicyGuard, PolicyResult } from './types';

function fixedGuard(name: string, result: Omit<PolicyResult, 'guard'>): PolicyGuard {
  return {
    name,
    check: async () => result,
  };
}

const baseCtx: PaymentContext = {
  tenantId: 'tnt_test',
  amountMicroUsdc: 100_000n,
  kind: 'x402',
};

describe('PolicyChain', () => {
  test('empty chain → allowed', async () => {
    const chain = new PolicyChain([]);
    const r = await chain.check(baseCtx);
    expect(r.allowed).toBe(true);
    expect(r.requiresApproval).toBeUndefined();
    expect(r.trace).toEqual([]);
  });

  test('all-allow → allowed with full trace', async () => {
    const chain = new PolicyChain([
      fixedGuard('a', { allowed: true, reason: 'ok-a' }),
      fixedGuard('b', { allowed: true, reason: 'ok-b' }),
    ]);
    const r = await chain.check(baseCtx);
    expect(r.allowed).toBe(true);
    expect(r.trace).toHaveLength(2);
    expect(r.trace[0].guard).toBe('a');
    expect(r.trace[1].guard).toBe('b');
  });

  test('first hard reject short-circuits', async () => {
    let bChecked = false;
    const chain = new PolicyChain([
      fixedGuard('a', { allowed: false, reason: 'nope' }),
      {
        name: 'b',
        check: async () => {
          bChecked = true;
          return { allowed: true } as const;
        },
      },
    ]);
    const r = await chain.check(baseCtx);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('nope');
    expect(r.guard).toBe('a');
    expect(bChecked).toBe(false);
    expect(r.trace).toHaveLength(1);
  });

  test('requiresApproval propagates without blocking subsequent guards', async () => {
    const chain = new PolicyChain([
      fixedGuard('a', { allowed: true, requiresApproval: true, reason: 'needs review' }),
      fixedGuard('b', { allowed: true, reason: 'ok-b' }),
    ]);
    const r = await chain.check(baseCtx);
    expect(r.allowed).toBe(true);
    expect(r.requiresApproval).toBe(true);
    expect(r.reason).toBe('needs review');
    expect(r.guard).toBe('a');
    expect(r.trace).toHaveLength(2);
  });

  test('reject after approval still wins', async () => {
    const chain = new PolicyChain([
      fixedGuard('a', { allowed: true, requiresApproval: true }),
      fixedGuard('b', { allowed: false, reason: 'budget over' }),
    ]);
    const r = await chain.check(baseCtx);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('budget over');
    expect(r.guard).toBe('b');
  });

  test('chain fills `at` when missing', async () => {
    let observedAt: Date | undefined;
    const chain = new PolicyChain([
      {
        name: 'a',
        check: async ctx => {
          observedAt = ctx.at;
          return { allowed: true };
        },
      },
    ]);
    await chain.check(baseCtx);
    expect(observedAt).toBeInstanceOf(Date);
  });
});
