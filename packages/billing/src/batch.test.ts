import { test, expect } from 'bun:test';
import {
  buildAndSettleBatch,
  retrySettlingBatches,
  MAX_RETRIES,
  type BatchStore,
  type SettleFn,
} from './batch';

function makeStore(): BatchStore & { state: any } {
  const batches: Record<string, { id: string; tenantId: string; totalMicroUsdc: bigint; retryCount: number; status: string }> = {};
  const state = { batches, claimed: [] as string[], statusUpdates: [] as any[] };
  return {
    state,
    findClaimableEvents: async () => [
      { id: 'e1', priceMicroUsdc: 100n },
      { id: 'e2', priceMicroUsdc: 250n },
    ],
    openBatch: async (args) => {
      const id = `batch-${Object.keys(batches).length + 1}`;
      batches[id] = { id, tenantId: args.tenantId, totalMicroUsdc: args.totalMicroUsdc, retryCount: 0, status: 'pending' };
      return { id };
    },
    claimEventsForBatch: async ({ eventIds }) => { state.claimed.push(...eventIds); },
    updateBatchStatus: async (args) => {
      state.statusUpdates.push(args);
      const b = batches[args.batchId];
      if (b) b.status = args.status;
    },
    incrementRetry: async ({ batchId }) => {
      const b = batches[batchId];
      if (!b) throw new Error('unknown batch');
      b.retryCount += 1;
      return { retryCount: b.retryCount };
    },
    findSettlingBatches: async ({ maxRetryCount }) =>
      Object.values(batches).filter(b => b.status === 'settling' && b.retryCount < maxRetryCount),
  };
}

test('buildAndSettleBatch: transient failure returns retrying status (retryCount=1)', async () => {
  const store = makeStore();
  let calls = 0;
  const settle: SettleFn = async () => {
    calls += 1;
    throw new Error('rpc timeout');
  };
  const result = await buildAndSettleBatch(store, settle, { tenantId: 't1' });
  expect(calls).toBe(1);
  expect(result.status).toBe('retrying');
  if (result.status === 'retrying') expect(result.retryCount).toBe(1);
  // Batch stays in `settling` (NOT `failed`) so a later retry sweep picks it up.
  const last = store.state.statusUpdates.at(-1);
  expect(last.status).toBe('settling');
});

test(`buildAndSettleBatch: after ${MAX_RETRIES} failures status transitions to failed`, async () => {
  const store = makeStore();
  const settle: SettleFn = async () => { throw new Error('perm'); };
  // First attempt via build.
  await buildAndSettleBatch(store, settle, { tenantId: 't1' });
  // Two more attempts via the sweeper.
  await retrySettlingBatches(store, settle, { olderThanMs: 0 });
  const third = await retrySettlingBatches(store, settle, { olderThanMs: 0 });
  expect(third.length).toBe(1);
  expect(third[0].status).toBe('failed');
  if (third[0].status === 'failed') expect(third[0].retryCount).toBe(MAX_RETRIES);
});

test('retrySettlingBatches: success on retry transitions batch → settled', async () => {
  const store = makeStore();
  let attempts = 0;
  const settle: SettleFn = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('flake');
    return { txHash: '0xgood' };
  };
  const first = await buildAndSettleBatch(store, settle, { tenantId: 't1' });
  expect(first.status).toBe('retrying');
  const retried = await retrySettlingBatches(store, settle, { olderThanMs: 0 });
  expect(retried[0].status).toBe('settled');
  if (retried[0].status === 'settled') expect(retried[0].txHash).toBe('0xgood');
});

test('retrySettlingBatches: skips batches at retry cap', async () => {
  const store = makeStore();
  store.state.batches['stuck'] = { id: 'stuck', tenantId: 't2', totalMicroUsdc: 500n, retryCount: MAX_RETRIES, status: 'settling' };
  const settle: SettleFn = async () => { throw new Error('should not be called'); };
  const result = await retrySettlingBatches(store, settle, { olderThanMs: 0 });
  expect(result.length).toBe(0);
});
