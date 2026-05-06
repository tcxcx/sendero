/**
 * find_resolved_gap — gate + happy/sad path tests.
 *
 * Phoenix queries are stubbed via `deps.find`; live integration is
 * verified by running the seed script against Phoenix Cloud and
 * triggering one of the 4 known-bug hypotheses on a sandbox turn.
 */

import { describe, expect, test } from 'bun:test';

import {
  defaultDeps as _defaults,
  runFindResolvedGap,
  type FindResolvedGapDeps,
} from './find-resolved-gap';
import type { ToolContext } from './types';

function makeCtx(overrides?: Partial<ToolContext>): ToolContext {
  return {
    traveler: { tenantId: 'org_test', userId: 'usr_1', name: 'Test' },
    caller: { effectiveKeyType: 'sandbox', keyType: 'sandbox', scopes: ['*'] },
    ...overrides,
  };
}

const documentUrlHit = {
  exampleId: 'ex_doc_url',
  hypothesis: 'documentImageUrl is wrong, should be documentUrl',
  fixSummary: 'Tool accepts `documentUrl`, not `documentImageUrl`. Rename in the call.',
  toolName: 'scan_document',
  kind: 'tool_input_mismatch' as const,
  resolutionPrUrl: 'https://github.com/sendero/sendero/pull/1234',
  mustMention: ['documentUrl'],
  provenance: 'human-curated' as const,
  score: 0.83,
};

const stubDepsFound: FindResolvedGapDeps = {
  find: async () => ({ available: true, hit: documentUrlHit, candidates: [] }),
};

const stubDepsNotFound: FindResolvedGapDeps = {
  find: async () => ({ available: true, candidates: [{ exampleId: 'ex_x', score: 0.12 }] }),
};

const stubDepsUnavailable: FindResolvedGapDeps = {
  find: async () => ({ available: false, reason: 'dataset-not-seeded' }),
};

describe('find_resolved_gap — dev-only gate', () => {
  test('returns production_refused when caller is a production prod-key', async () => {
    const ctx = makeCtx({
      caller: { effectiveKeyType: 'production', keyType: 'production', scopes: ['*'] },
    });
    const result = await runFindResolvedGap(
      { hypothesis: 'tool returns undefined for documentImageUrl' },
      ctx,
      stubDepsFound
    );
    expect(result.status).toBe('production_refused');
  });

  test('returns production_refused when ctx.traveler.tenantId is missing', async () => {
    const ctx: ToolContext = {
      caller: { effectiveKeyType: 'sandbox', keyType: 'sandbox', scopes: ['*'] },
    };
    const result = await runFindResolvedGap(
      { hypothesis: 'tool returns undefined for documentImageUrl' },
      ctx,
      stubDepsFound
    );
    expect(result.status).toBe('production_refused');
  });
});

describe('find_resolved_gap — happy + sad paths', () => {
  test('returns found with fix + mustMention when match exists', async () => {
    const ctx = makeCtx();
    const result = await runFindResolvedGap(
      { hypothesis: 'documentImageUrl undefined', toolName: 'scan_document' },
      ctx,
      stubDepsFound
    );
    expect(result.status).toBe('found');
    if (result.status === 'found') {
      expect(result.hit.mustMention).toContain('documentUrl');
      expect(result.message).toContain('documentUrl');
      expect(result.message).toContain('Do NOT');
    }
  });

  test('returns not_found when no match — agent should call report_knowledge_gap next', async () => {
    const ctx = makeCtx();
    const result = await runFindResolvedGap(
      { hypothesis: 'something completely new and unique' },
      ctx,
      stubDepsNotFound
    );
    expect(result.status).toBe('not_found');
    if (result.status === 'not_found') {
      expect(result.message).toContain('report_knowledge_gap');
    }
  });

  test('returns unavailable when Phoenix is down — agent falls through to report_knowledge_gap', async () => {
    const ctx = makeCtx();
    const result = await runFindResolvedGap(
      { hypothesis: 'tool returns undefined' },
      ctx,
      stubDepsUnavailable
    );
    expect(result.status).toBe('unavailable');
    if (result.status === 'unavailable') {
      expect(result.reason).toBe('dataset-not-seeded');
      expect(result.message).toContain('cold path');
    }
  });
});
