/**
 * recall_similar_turns — gate + happy/sad path tests.
 *
 * Phoenix REST is mocked via the `deps.recall` injection — these
 * tests don't hit a real Phoenix instance. Live integration verification
 * lives outside unit tests (manual smoke after any agent turn lands
 * in Phoenix Cloud).
 */

import { describe, expect, test } from 'bun:test';

import {
  defaultDeps as _defaults,
  runRecallSimilarTurns,
  type RecallSimilarTurnsDeps,
} from './recall-similar-turns';
import type { ToolContext } from './types';

function makeCtx(overrides?: Partial<ToolContext>): ToolContext {
  return {
    traveler: { tenantId: 'org_test', userId: 'usr_1', name: 'Test' },
    caller: { effectiveKeyType: 'sandbox', keyType: 'sandbox', scopes: ['*'] },
    ...overrides,
  };
}

const stubDepsOk: RecallSimilarTurnsDeps = {
  recall: async () => ({
    available: true,
    results: [
      {
        traceId: 't_abc',
        summary: 'Book SFO-LHR Thursday under 1800',
        outcome: 'completed',
        latencyMs: 9200,
        evalScore: 0.92,
        appliedTools: ['search_flights', 'hold', 'confirm_booking'],
        provenance: 'live-trace',
        occurredAt: '2026-04-22T14:00:00Z',
      },
    ],
  }),
};

const stubDepsUnavailable: RecallSimilarTurnsDeps = {
  recall: async () => ({
    available: false,
    reason: 'phoenix-not-configured',
    results: [],
  }),
};

const stubDepsEmpty: RecallSimilarTurnsDeps = {
  recall: async () => ({
    available: true,
    results: [],
  }),
};

describe('recall_similar_turns — dev-only gate', () => {
  test('returns production_refused when caller is a production prod-key', async () => {
    const ctx = makeCtx({
      caller: { effectiveKeyType: 'production', keyType: 'production', scopes: ['*'] },
    });
    const result = await runRecallSimilarTurns(
      { query: 'book SFO LHR', limit: 3 },
      ctx,
      stubDepsOk
    );
    expect(result.status).toBe('production_refused');
  });

  test('returns production_refused when ctx.traveler.tenantId is missing', async () => {
    const ctx: ToolContext = {
      caller: { effectiveKeyType: 'sandbox', keyType: 'sandbox', scopes: ['*'] },
    };
    const result = await runRecallSimilarTurns({ query: 'q', limit: 3 }, ctx, stubDepsOk);
    expect(result.status).toBe('production_refused');
  });

  test('refuses when NODE_ENV=production AND VERCEL_ENV=production (env gate)', async () => {
    const prevNode = process.env.NODE_ENV;
    const prevVercel = process.env.VERCEL_ENV;
    process.env.NODE_ENV = 'production';
    process.env.VERCEL_ENV = 'production';
    try {
      const ctx = makeCtx();
      const result = await runRecallSimilarTurns({ query: 'q', limit: 3 }, ctx, stubDepsOk);
      expect(result.status).toBe('production_refused');
    } finally {
      if (prevNode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNode;
      if (prevVercel === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = prevVercel;
    }
  });
});

describe('recall_similar_turns — happy + sad paths', () => {
  test('returns ok with results when Phoenix returns matches', async () => {
    const ctx = makeCtx();
    const result = await runRecallSimilarTurns(
      { query: 'book SFO-LHR Thursday', route: 'SFO-LHR', limit: 3 },
      ctx,
      stubDepsOk
    );
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.results).toHaveLength(1);
      expect(result.results[0]?.evalScore).toBe(0.92);
      expect(result.message).toContain('hint');
    }
  });

  test('returns ok with empty results + cold-path message', async () => {
    const ctx = makeCtx();
    const result = await runRecallSimilarTurns({ query: 'q', limit: 3 }, ctx, stubDepsEmpty);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.results).toHaveLength(0);
      expect(result.message).toContain('cold');
    }
  });

  test('returns unavailable when Phoenix is down / not configured', async () => {
    const ctx = makeCtx();
    const result = await runRecallSimilarTurns({ query: 'q', limit: 3 }, ctx, stubDepsUnavailable);
    expect(result.status).toBe('unavailable');
    if (result.status === 'unavailable') {
      expect(result.reason).toBe('phoenix-not-configured');
      expect(result.message).toContain('Plan from scratch');
    }
  });
});
