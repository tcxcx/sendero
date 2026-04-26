import { describe, expect, test } from 'bun:test';

import { SingleTxGuard } from './single-tx';

const baseCtx = {
  tenantId: 'tnt_test',
  kind: 'transfer' as const,
  amountMicroUsdc: 0n,
  recipient: '0xabc',
};

describe('SingleTxGuard', () => {
  test('amount under ceiling → allowed', async () => {
    const guard = new SingleTxGuard({ maxMicroUsdc: 5_000_000n });
    const r = await guard.check({ ...baseCtx, amountMicroUsdc: 1_000_000n });
    expect(r.allowed).toBe(true);
  });

  test('amount equal to ceiling → allowed', async () => {
    const guard = new SingleTxGuard({ maxMicroUsdc: 1_000_000n });
    const r = await guard.check({ ...baseCtx, amountMicroUsdc: 1_000_000n });
    expect(r.allowed).toBe(true);
  });

  test('amount over ceiling → blocked', async () => {
    const guard = new SingleTxGuard({ maxMicroUsdc: 1_000_000n });
    const r = await guard.check({ ...baseCtx, amountMicroUsdc: 1_000_001n });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('single-tx ceiling exceeded');
  });
});
