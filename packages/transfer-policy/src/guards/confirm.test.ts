import { describe, expect, test } from 'bun:test';

import { ConfirmGuard } from './confirm';

const baseCtx = {
  tenantId: 'tnt_test',
  amountMicroUsdc: 0n,
  kind: 'transfer' as const,
  recipient: '0xabc',
};

describe('ConfirmGuard', () => {
  test('default trigger 0 → every payment requires approval', async () => {
    const guard = new ConfirmGuard();
    const r = await guard.check({ ...baseCtx, amountMicroUsdc: 1_000n });
    expect(r.allowed).toBe(true);
    expect(r.requiresApproval).toBe(true);
  });

  test('preApproved bypasses', async () => {
    const guard = new ConfirmGuard();
    const r = await guard.check({
      ...baseCtx,
      amountMicroUsdc: 1_000n,
      preApproved: true,
    });
    expect(r.allowed).toBe(true);
    expect(r.requiresApproval).toBeUndefined();
    expect(r.reason).toBe('pre-approved by operator');
  });

  test('amount below trigger → no approval required', async () => {
    const guard = new ConfirmGuard({ triggerAtMicroUsdc: 1_000_000_000n });
    const r = await guard.check({ ...baseCtx, amountMicroUsdc: 500_000n });
    expect(r.allowed).toBe(true);
    expect(r.requiresApproval).toBeUndefined();
  });

  test('amount at or above trigger → requires approval', async () => {
    const guard = new ConfirmGuard({ triggerAtMicroUsdc: 1_000_000n });
    const r = await guard.check({
      ...baseCtx,
      amountMicroUsdc: 1_000_000n,
    });
    expect(r.allowed).toBe(true);
    expect(r.requiresApproval).toBe(true);
  });

  test('custom reason surfaces', async () => {
    const guard = new ConfirmGuard({ reason: 'finance review' });
    const r = await guard.check({ ...baseCtx, amountMicroUsdc: 1n });
    expect(r.reason).toBe('finance review');
  });
});
