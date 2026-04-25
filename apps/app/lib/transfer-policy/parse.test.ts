import { describe, expect, test } from 'bun:test';

import {
  BudgetGuard,
  type BudgetStore,
  ConfirmGuard,
  type RateLimitStore,
  RateLimitGuard,
  RecipientGuard,
  SingleTxGuard,
} from '@sendero/transfer-policy';

import { buildGuardFromRow, type PolicyRow } from './parse';

const noopStore: BudgetStore & RateLimitStore = {
  spentInWindow: async () => 0n,
  countInWindow: async () => 0,
};

const deps = { budgetStore: noopStore, rateLimitStore: noopStore, warn: () => {} };

const row = (overrides: Partial<PolicyRow> = {}): PolicyRow => ({
  id: 'pol_test',
  scope: 'tenant',
  guardKind: 'budget',
  config: { period: 'daily', capMicroUsdc: '50000000' },
  hardCap: true,
  ...overrides,
});

describe('buildGuardFromRow', () => {
  test('budget row → BudgetGuard with parsed bigint cap', () => {
    const guard = buildGuardFromRow(row(), deps);
    expect(guard).toBeInstanceOf(BudgetGuard);
    expect(guard?.name).toBe('budget:tenant:daily');
  });

  test('single_tx row → SingleTxGuard', () => {
    const guard = buildGuardFromRow(
      row({ guardKind: 'single_tx', config: { maxMicroUsdc: '5000000' } }),
      deps
    );
    expect(guard).toBeInstanceOf(SingleTxGuard);
  });

  test('recipient.allow row → RecipientGuard', () => {
    const guard = buildGuardFromRow(
      row({
        guardKind: 'recipient',
        config: { mode: 'allow', addresses: ['0xa1', '0xb2'] },
      }),
      deps
    );
    expect(guard).toBeInstanceOf(RecipientGuard);
    expect(guard?.name).toBe('recipient:allow');
  });

  test('rate_limit row → RateLimitGuard scoped from row.scope', () => {
    const guard = buildGuardFromRow(
      row({
        scope: 'traveler',
        guardKind: 'rate_limit',
        config: { maxCount: 5, windowMs: 60_000 },
      }),
      deps
    );
    expect(guard).toBeInstanceOf(RateLimitGuard);
    expect(guard?.name).toBe('rate_limit:traveler');
  });

  test('confirm row → ConfirmGuard, default trigger 0', () => {
    const guard = buildGuardFromRow(row({ guardKind: 'confirm', config: {} }), deps);
    expect(guard).toBeInstanceOf(ConfirmGuard);
  });

  test('confirm row honors triggerAtMicroUsdc string', () => {
    const guard = buildGuardFromRow(
      row({
        guardKind: 'confirm',
        config: { triggerAtMicroUsdc: '1000000000', reason: 'finance review' },
      }),
      deps
    );
    expect(guard).toBeInstanceOf(ConfirmGuard);
  });

  test('unknown scope → null', () => {
    expect(buildGuardFromRow(row({ scope: 'wat' }), deps)).toBeNull();
  });

  test('unknown guardKind → null', () => {
    expect(buildGuardFromRow(row({ guardKind: 'frobnicate' }), deps)).toBeNull();
  });

  test('budget.period invalid → null', () => {
    expect(
      buildGuardFromRow(
        row({ guardKind: 'budget', config: { period: 'hourly', capMicroUsdc: '1' } }),
        deps
      )
    ).toBeNull();
  });

  test('budget.capMicroUsdc non-numeric → null', () => {
    expect(
      buildGuardFromRow(
        row({ guardKind: 'budget', config: { period: 'daily', capMicroUsdc: 'lots' } }),
        deps
      )
    ).toBeNull();
  });

  test('config not object → null', () => {
    expect(buildGuardFromRow(row({ config: null }), deps)).toBeNull();
    expect(buildGuardFromRow(row({ config: ['nope'] }), deps)).toBeNull();
  });

  test('rate_limit invalid maxCount → null', () => {
    expect(
      buildGuardFromRow(
        row({ guardKind: 'rate_limit', config: { maxCount: 0, windowMs: 1000 } }),
        deps
      )
    ).toBeNull();
  });

  test('recipient.mode invalid → null', () => {
    expect(
      buildGuardFromRow(
        row({
          guardKind: 'recipient',
          config: { mode: 'maybe', addresses: ['0xa1'] },
        }),
        deps
      )
    ).toBeNull();
  });

  test('warn callback fires once per skipped row', () => {
    let calls = 0;
    buildGuardFromRow(row({ scope: 'wat' }), { ...deps, warn: () => calls++ });
    expect(calls).toBe(1);
  });

  test('parseBigint accepts numeric strings, rejects negatives + non-digits', () => {
    expect(
      buildGuardFromRow(row({ config: { period: 'daily', capMicroUsdc: '0' } }), deps)
    ).not.toBeNull();
    expect(
      buildGuardFromRow(row({ config: { period: 'daily', capMicroUsdc: '-1' } }), deps)
    ).toBeNull();
    expect(
      buildGuardFromRow(row({ config: { period: 'daily', capMicroUsdc: 5_000_000 } }), deps)
    ).not.toBeNull();
  });
});
