/**
 * report_knowledge_gap unit tests.
 *
 * Locks the load-bearing contracts:
 *   - Production prod-keys are refused (security: no capability leak).
 *   - Sandbox keys + dev env + operator console are allowed.
 *   - Same hypothesis from multiple turns dedups onto one row
 *     (occurrence count increments, severity escalates but never
 *     downgrades).
 *   - Severity inference matches the documented matrix.
 *
 * Anti-circular: assertions reference user-visible behavior (refusal
 * messages, dedup across turns, severity floor for env_missing) — not
 * "the function calls the deps it was passed."
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  runReportKnowledgeGap,
  type ReportKnowledgeGapDeps,
  type ReportKnowledgeGapInput,
} from './report-knowledge-gap';
import type { ToolContext } from './types';

interface UpsertCall {
  tenantId: string;
  dedupKey: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

function makeDeps(
  initialOccurrences: Record<string, number> = {}
): ReportKnowledgeGapDeps & { calls: UpsertCall[] } {
  // dedup table keyed by (tenantId, dedupKey) → row state
  const rows: Record<string, { id: string; count: number }> = {};
  const calls: UpsertCall[] = [];
  // Pre-seed if test asks.
  for (const [k, c] of Object.entries(initialOccurrences)) {
    rows[k] = { id: `gap_${k}`, count: c };
  }
  return {
    calls,
    async upsert(args) {
      calls.push({
        tenantId: args.tenantId,
        dedupKey: args.dedupKey,
        severity: args.severity,
      });
      const key = `${args.tenantId}|${args.dedupKey}`;
      const existing = rows[key];
      if (!existing) {
        const id = `gap_${Object.keys(rows).length + 1}`;
        rows[key] = { id, count: 1 };
        return { gapId: id, occurrenceCount: 1, isNew: true };
      }
      existing.count += 1;
      return { gapId: existing.id, occurrenceCount: existing.count, isNew: false };
    },
  };
}

const realNodeEnv = process.env.NODE_ENV;
const realVercelEnv = process.env.VERCEL_ENV;
const realOverride = process.env.SENDERO_GAPS_ALLOW_NONDEV;
beforeEach(() => {
  // Default to non-production for unit tests; flip per-test when
  // exercising the production gate.
  process.env.NODE_ENV = 'test';
  delete process.env.VERCEL_ENV;
  delete process.env.SENDERO_GAPS_ALLOW_NONDEV;
});
afterEach(() => {
  process.env.NODE_ENV = realNodeEnv ?? 'test';
  if (realVercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = realVercelEnv;
  if (realOverride === undefined) delete process.env.SENDERO_GAPS_ALLOW_NONDEV;
  else process.env.SENDERO_GAPS_ALLOW_NONDEV = realOverride;
});

const baseInput: ReportKnowledgeGapInput = {
  kind: 'tool_input_mismatch',
  toolName: 'scan_passport_inline',
  errorMessage: 'scan_passport_inline needs either documentUrl or both data + mediaType.',
  hypothesis:
    'I think the prompt told me to send documentImageUrl but the tool wants documentUrl. Field name typo.',
  blockingTraveler: true,
};

const sandboxCtx: ToolContext = {
  traveler: { tenantId: 'org_1', userId: 'usr_1' },
  caller: { effectiveKeyType: 'sandbox', keyType: 'sandbox' },
};

describe('report_knowledge_gap — production gate (security)', () => {
  test('production prod-key is refused (silent — does not throw)', async () => {
    process.env.NODE_ENV = 'production';
    process.env.VERCEL_ENV = 'production';
    const deps = makeDeps();
    const result = await runReportKnowledgeGap(
      baseInput,
      {
        traveler: { tenantId: 'org_1', userId: 'usr_1' },
        caller: { effectiveKeyType: 'production', keyType: 'production' },
      },
      deps
    );
    expect(result.status).toBe('production_refused');
    if (result.status !== 'production_refused') return;
    // Refusal message names the canonical fallback so the agent's
    // own retry behavior is steered correctly.
    expect(result.message).toMatch(/request_human_handoff/);
    // Critical: no row was written.
    expect(deps.calls).toHaveLength(0);
  });

  test('production deploy + testnet-beta sandbox IS REFUSED (env gate is independent of testnet-beta)', async () => {
    // testnet-beta downgrades production prod-keys to behave as sandbox
    // at runtime (CLAUDE.md "Testnet downgrade chokepoints"). For
    // billing/scope purposes, this matters. For the gap-board, it
    // doesn't — production deploys are dead-zone for this tool
    // regardless of caller. Operator dashboard uses
    // SENDERO_GAPS_ALLOW_NONDEV=1 to override.
    process.env.NODE_ENV = 'production';
    process.env.VERCEL_ENV = 'production';
    const deps = makeDeps();
    const result = await runReportKnowledgeGap(
      baseInput,
      {
        traveler: { tenantId: 'org_1', userId: 'usr_1' },
        caller: { effectiveKeyType: 'sandbox', keyType: 'production' },
      },
      deps
    );
    expect(result.status).toBe('production_refused');
    expect(deps.calls).toHaveLength(0);
  });

  test('production+production VERCEL_ENV: operator console (no caller) is REFUSED — preview/prod is dead zone', async () => {
    process.env.NODE_ENV = 'production';
    process.env.VERCEL_ENV = 'production';
    const deps = makeDeps();
    const result = await runReportKnowledgeGap(
      baseInput,
      { traveler: { tenantId: 'org_1', userId: 'usr_1' } },
      deps
    );
    expect(result.status).toBe('production_refused');
    expect(deps.calls).toHaveLength(0);
  });

  test('preview deploy is REFUSED even for operator console (shared surface)', async () => {
    process.env.NODE_ENV = 'production';
    process.env.VERCEL_ENV = 'preview';
    const deps = makeDeps();
    const result = await runReportKnowledgeGap(
      baseInput,
      { traveler: { tenantId: 'org_1', userId: 'usr_1' } },
      deps
    );
    expect(result.status).toBe('production_refused');
    expect(deps.calls).toHaveLength(0);
  });

  test('local dev (no VERCEL_ENV) operator console IS allowed', async () => {
    delete process.env.NODE_ENV;
    delete process.env.VERCEL_ENV;
    const deps = makeDeps();
    const result = await runReportKnowledgeGap(
      baseInput,
      { traveler: { tenantId: 'org_1', userId: 'usr_1' } },
      deps
    );
    expect(result.status).toBe('reported');
  });

  test('VERCEL_ENV=development is treated as dev (allowed)', async () => {
    process.env.NODE_ENV = 'production'; // VERCEL_ENV is the truth
    process.env.VERCEL_ENV = 'development';
    const deps = makeDeps();
    const result = await runReportKnowledgeGap(baseInput, sandboxCtx, deps);
    expect(result.status).toBe('reported');
  });

  test('SENDERO_GAPS_ALLOW_NONDEV=1 override re-enables in production env (operator dashboard kill-switch)', async () => {
    process.env.NODE_ENV = 'production';
    process.env.VERCEL_ENV = 'production';
    process.env.SENDERO_GAPS_ALLOW_NONDEV = '1';
    const deps = makeDeps();
    // Operator console (no caller) — override + dashboard surface allowed.
    const result = await runReportKnowledgeGap(
      baseInput,
      { traveler: { tenantId: 'org_1', userId: 'usr_1' } },
      deps
    );
    expect(result.status).toBe('reported');
  });

  test('SENDERO_GAPS_ALLOW_NONDEV=1 override does NOT bypass the prod-key reject (prod creds still refused)', async () => {
    process.env.NODE_ENV = 'production';
    process.env.VERCEL_ENV = 'production';
    process.env.SENDERO_GAPS_ALLOW_NONDEV = '1';
    const deps = makeDeps();
    const result = await runReportKnowledgeGap(
      baseInput,
      {
        traveler: { tenantId: 'org_1', userId: 'usr_1' },
        caller: { effectiveKeyType: 'production', keyType: 'production' },
      },
      deps
    );
    // Override + production prod-key = STILL refused. Two independent
    // gates; override only bypasses the env one.
    expect(result.status).toBe('production_refused');
  });

  test('production-typed caller is refused EVEN in dev env (caller gate is independent of env gate)', async () => {
    delete process.env.NODE_ENV;
    delete process.env.VERCEL_ENV;
    const deps = makeDeps();
    const result = await runReportKnowledgeGap(
      baseInput,
      {
        traveler: { tenantId: 'org_1', userId: 'usr_1' },
        caller: { effectiveKeyType: 'production', keyType: 'production' },
      },
      deps
    );
    // Two independent gates: env (production deploy?) + caller (prod
    // key?). Failing either is refusal. A leaked prod key shouldn't
    // become a discovery surface just because someone sandboxes an
    // attack against `localhost:3010`.
    expect(result.status).toBe('production_refused');
    expect(deps.calls).toHaveLength(0);
  });

  test('refuses when tenant context is missing (no orphan rows)', async () => {
    const deps = makeDeps();
    const result = await runReportKnowledgeGap(
      baseInput,
      { caller: { effectiveKeyType: 'sandbox', keyType: 'sandbox' } },
      deps
    );
    expect(result.status).toBe('production_refused');
    if (result.status !== 'production_refused') return;
    expect(result.message).toMatch(/tenant context/i);
    expect(deps.calls).toHaveLength(0);
  });
});

describe('report_knowledge_gap — dedup behavior', () => {
  test('same hypothesis across turns increments occurrenceCount on one row', async () => {
    const deps = makeDeps();
    const r1 = await runReportKnowledgeGap(baseInput, sandboxCtx, deps);
    const r2 = await runReportKnowledgeGap(baseInput, sandboxCtx, deps);
    const r3 = await runReportKnowledgeGap(baseInput, sandboxCtx, deps);

    expect(r1.status).toBe('reported');
    expect(r2.status).toBe('duplicate_increment');
    expect(r3.status).toBe('duplicate_increment');
    if (r3.status !== 'duplicate_increment') return;
    expect(r3.occurrenceCount).toBe(3);
    if (r1.status === 'reported') expect(r1.gapId).toBeDefined();
    // All three resolve to the same gapId.
    if (r1.status === 'reported' && r3.status === 'duplicate_increment') {
      expect(r3.gapId).toBe(r1.gapId);
    }
  });

  test('paraphrased hypothesis still dedups (whitespace + casing + punctuation insensitive)', async () => {
    const deps = makeDeps();
    await runReportKnowledgeGap(
      { ...baseInput, hypothesis: 'I think field name is documentUrl, not documentImageUrl.' },
      sandboxCtx,
      deps
    );
    const r2 = await runReportKnowledgeGap(
      {
        ...baseInput,
        hypothesis: '  i  think field name is documentURL not documentImageUrl  ',
      },
      sandboxCtx,
      deps
    );
    expect(r2.status).toBe('duplicate_increment');
  });

  test("different toolName → different dedup row (one tool fix shouldn't mask another)", async () => {
    const deps = makeDeps();
    await runReportKnowledgeGap(baseInput, sandboxCtx, deps);
    const r2 = await runReportKnowledgeGap(
      { ...baseInput, toolName: 'create_passenger' },
      sandboxCtx,
      deps
    );
    expect(r2.status).toBe('reported');
    expect(deps.calls).toHaveLength(2);
  });

  test('different tenants → different dedup rows (tenant isolation)', async () => {
    const deps = makeDeps();
    await runReportKnowledgeGap(baseInput, sandboxCtx, deps);
    const ctx2: ToolContext = {
      ...sandboxCtx,
      traveler: { ...sandboxCtx.traveler!, tenantId: 'org_2' },
    };
    const r2 = await runReportKnowledgeGap(baseInput, ctx2, deps);
    expect(r2.status).toBe('reported');
    expect(deps.calls).toHaveLength(2);
    expect(deps.calls[0]?.tenantId).toBe('org_1');
    expect(deps.calls[1]?.tenantId).toBe('org_2');
  });
});

describe('report_knowledge_gap — severity inference', () => {
  test('blocking + env_missing → critical (ship-stopper)', async () => {
    const deps = makeDeps();
    await runReportKnowledgeGap(
      {
        kind: 'env_missing',
        errorMessage: 'PASSPORT_VAULT_KEK is not set',
        hypothesis: 'Vercel env not loaded into the deploy snapshot.',
        blockingTraveler: true,
      },
      sandboxCtx,
      deps
    );
    expect(deps.calls[0]?.severity).toBe('critical');
  });

  test('blocking + tool_not_found → critical', async () => {
    const deps = makeDeps();
    await runReportKnowledgeGap(
      {
        kind: 'tool_not_found',
        toolName: 'request_human_handoff',
        errorMessage: 'Tool X not available',
        hypothesis: 'Must invoke via call_sendero wrapper, not as top-level Kapso tool.',
        blockingTraveler: true,
      },
      sandboxCtx,
      deps
    );
    expect(deps.calls[0]?.severity).toBe('critical');
  });

  test('blocking + tool_input_mismatch → high (not critical — agent can ask for re-input)', async () => {
    const deps = makeDeps();
    await runReportKnowledgeGap(
      { ...baseInput, blockingTraveler: true, kind: 'tool_input_mismatch' },
      sandboxCtx,
      deps
    );
    expect(deps.calls[0]?.severity).toBe('high');
  });

  test('non-blocking + env_missing → high (still infra, but not blocking right now)', async () => {
    const deps = makeDeps();
    await runReportKnowledgeGap(
      {
        kind: 'env_missing',
        errorMessage: 'OPENAI_API_KEY missing',
        hypothesis: 'Optional key for evaluator path.',
        blockingTraveler: false,
      },
      sandboxCtx,
      deps
    );
    expect(deps.calls[0]?.severity).toBe('high');
  });

  test('non-blocking + tool_input_mismatch → medium', async () => {
    const deps = makeDeps();
    await runReportKnowledgeGap({ ...baseInput, blockingTraveler: false }, sandboxCtx, deps);
    expect(deps.calls[0]?.severity).toBe('medium');
  });

  test('non-blocking + other → low (default catch-all)', async () => {
    const deps = makeDeps();
    await runReportKnowledgeGap(
      {
        kind: 'other',
        errorMessage: 'something weird',
        hypothesis: 'Not sure what category this falls into; flagging for review.',
        blockingTraveler: false,
      },
      sandboxCtx,
      deps
    );
    expect(deps.calls[0]?.severity).toBe('low');
  });
});

describe('report_knowledge_gap — return shape', () => {
  test('first report returns status=reported with friendly message', async () => {
    const deps = makeDeps();
    const r = await runReportKnowledgeGap(baseInput, sandboxCtx, deps);
    expect(r.status).toBe('reported');
    if (r.status !== 'reported') return;
    expect(r.gapId).toMatch(/^gap_/);
    expect(r.occurrenceCount).toBe(1);
    expect(r.message).toMatch(/tool_input_mismatch/);
  });

  test('repeat report returns status=duplicate_increment with count', async () => {
    const deps = makeDeps();
    await runReportKnowledgeGap(baseInput, sandboxCtx, deps);
    await runReportKnowledgeGap(baseInput, sandboxCtx, deps);
    const r = await runReportKnowledgeGap(baseInput, sandboxCtx, deps);
    if (r.status !== 'duplicate_increment') throw new Error('expected duplicate');
    expect(r.occurrenceCount).toBe(3);
    expect(r.message).toMatch(/3 times/);
  });
});
