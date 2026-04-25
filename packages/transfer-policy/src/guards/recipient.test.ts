import { describe, expect, test } from 'bun:test';

import { RecipientGuard } from './recipient';

const baseCtx = {
  tenantId: 'tnt_test',
  kind: 'transfer' as const,
  amountMicroUsdc: 1_000_000n,
};

describe('RecipientGuard', () => {
  test('allow list matches case-insensitively', async () => {
    const guard = new RecipientGuard({
      mode: 'allow',
      list: ['0xAaAA1111', '0xbbbb2222'],
    });
    const r = await guard.check({ ...baseCtx, recipient: '0xaaaa1111' });
    expect(r.allowed).toBe(true);
  });

  test('allow list rejects unknown recipient', async () => {
    const guard = new RecipientGuard({ mode: 'allow', list: ['0xa1'] });
    const r = await guard.check({ ...baseCtx, recipient: '0xb2' });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('recipient not on allow list');
  });

  test('deny list rejects matched recipient', async () => {
    const guard = new RecipientGuard({ mode: 'deny', list: ['0xbad'] });
    const r = await guard.check({ ...baseCtx, recipient: '0xbad' });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('recipient on deny list');
  });

  test('deny list passes other recipients through', async () => {
    const guard = new RecipientGuard({ mode: 'deny', list: ['0xbad'] });
    const r = await guard.check({ ...baseCtx, recipient: '0xgood' });
    expect(r.allowed).toBe(true);
  });

  test('null recipient (x402) → allowed regardless', async () => {
    const guard = new RecipientGuard({ mode: 'allow', list: ['0xa1'] });
    const r = await guard.check({ ...baseCtx, recipient: null, kind: 'x402' });
    expect(r.allowed).toBe(true);
  });
});
