/**
 * Gap-scanner rendering tests.
 *
 * Tests the pure functions (`bucket`, `renderBoard`, `renderEntry`,
 * `parseArgs`) — not the DB plumbing in `main()`. Anti-circular: the
 * assertions match the user-visible markdown the operator reads
 * (section headers, severity escalation rules, resolution surfacing).
 */

import { describe, expect, test } from 'bun:test';

import {
  bucket,
  parseArgs,
  renderBoard,
  renderEntry,
  type KnowledgeGapRow,
} from './scan-knowledge-gaps-render';

function gapFixture(over: Partial<KnowledgeGapRow> = {}): KnowledgeGapRow {
  const now = new Date('2026-05-05T12:00:00Z');
  return {
    id: 'gap_1',
    tenantId: 'org_test_tenant_id_xyz',
    traceId: null,
    kind: 'tool_input_mismatch',
    severity: 'medium',
    status: 'open',
    toolName: 'scan_passport_inline',
    errorMessage: 'documentImageUrl needs documentUrl',
    attemptedInput: null,
    hypothesis: 'I think the schema field is named differently than the prompt slab said.',
    suggestedFix: 'Rename in agent-persona.ts Story 4.2.',
    blockingTraveler: false,
    channelKind: 'whatsapp',
    surface: 'agent.kapso',
    reportedByUserId: null,
    resolvedAt: null,
    resolutionNote: null,
    resolutionPrUrl: null,
    dedupKey: 'abc123',
    occurrenceCount: 1,
    firstSeenAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
    lastSeenAt: new Date(now.getTime() - 60 * 60 * 1000),
    createdAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
    updatedAt: now,
    ...over,
  };
}

describe('bucket — severity rules', () => {
  test('severity=critical wins always', () => {
    expect(bucket(gapFixture({ severity: 'critical' }))).toBe('critical');
  });

  test('severity=high stays high', () => {
    expect(bucket(gapFixture({ severity: 'high' }))).toBe('high');
  });

  test('blocking + occurrenceCount≥3 promotes low/medium → high (repeat-offender)', () => {
    // This is the load-bearing rule: if a "low" gap fires 50 times AND
    // blocks travelers, it stops being low even though the column says
    // it is. The scanner is the truth, not the column.
    expect(
      bucket(gapFixture({ severity: 'low', blockingTraveler: true, occurrenceCount: 5 }))
    ).toBe('high');
  });

  test('blocking + occurrenceCount=1 does NOT promote (one-off, not yet a pattern)', () => {
    expect(
      bucket(gapFixture({ severity: 'low', blockingTraveler: true, occurrenceCount: 1 }))
    ).toBe('low');
  });

  test('non-blocking + high occurrenceCount stays at column severity (annoying but not urgent)', () => {
    expect(
      bucket(gapFixture({ severity: 'medium', blockingTraveler: false, occurrenceCount: 50 }))
    ).toBe('medium');
  });
});

describe('renderEntry — markdown output', () => {
  test('header includes tool name + kind label + occurrence multiplier when count > 1', () => {
    const md = renderEntry(gapFixture({ occurrenceCount: 7 }));
    expect(md).toContain('`scan_passport_inline`');
    expect(md).toContain('tool input ≠ schema');
    expect(md).toContain('×7');
  });

  test('header omits ×N when count is 1', () => {
    const md = renderEntry(gapFixture({ occurrenceCount: 1 }));
    expect(md).not.toMatch(/×1\b/);
  });

  test('blocking rows surface the 🚧 indicator', () => {
    const md = renderEntry(gapFixture({ blockingTraveler: true }));
    expect(md).toContain('🚧 blocking');
  });

  test('hypothesis is rendered as blockquote', () => {
    const md = renderEntry(gapFixture());
    expect(md).toContain(
      '> I think the schema field is named differently than the prompt slab said.'
    );
  });

  test('suggestedFix shows when present', () => {
    const md = renderEntry(gapFixture({ suggestedFix: 'Update prompt typo' }));
    expect(md).toContain('**Suggested fix:**');
    expect(md).toContain('Update prompt typo');
  });

  test('suggestedFix section is omitted when null', () => {
    const md = renderEntry(gapFixture({ suggestedFix: null }));
    expect(md).not.toContain('**Suggested fix:**');
  });

  test('errorMessage is wrapped in collapsible details (not always visible — keeps board scannable)', () => {
    const md = renderEntry(gapFixture({ errorMessage: 'huge error stack trace here' }));
    expect(md).toContain('<details><summary>Error</summary>');
    expect(md).toContain('huge error stack trace here');
  });

  test("tenantId is truncated in metadata (don't leak the full id into committed markdown)", () => {
    const md = renderEntry(gapFixture({ tenantId: 'org_super_long_tenant_id_with_lots_of_chars' }));
    // We slice to 12 chars + ellipsis
    expect(md).toContain('org_super_lo');
    expect(md).not.toContain('org_super_long_tenant_id_with_lots_of_chars');
  });
});

describe('renderBoard — full document', () => {
  test('empty open + zero resolved → "No open gaps" celebration section', () => {
    const md = renderBoard({
      open: [],
      recentlyResolved: [],
      generatedAt: new Date('2026-05-05T12:00:00Z'),
      resolveStaleDays: null,
      resolvedThisRun: [],
    });
    expect(md).toContain('🎉 No open gaps');
    expect(md).toContain('langfuse:regression');
  });

  test('top summary line counts blocking rows separately', () => {
    const md = renderBoard({
      open: [
        gapFixture({ blockingTraveler: true, severity: 'critical' }),
        gapFixture({ blockingTraveler: false, severity: 'medium' }),
      ],
      recentlyResolved: [],
      generatedAt: new Date('2026-05-05T12:00:00Z'),
      resolveStaleDays: null,
      resolvedThisRun: [],
    });
    expect(md).toContain('**2 open** · 1 blocking traveler');
  });

  test('sections render in severity order — critical first, low last', () => {
    const md = renderBoard({
      open: [
        gapFixture({ id: 'g_low', severity: 'low' }),
        gapFixture({ id: 'g_crit', severity: 'critical' }),
        gapFixture({ id: 'g_high', severity: 'high' }),
      ],
      recentlyResolved: [],
      generatedAt: new Date('2026-05-05T12:00:00Z'),
      resolveStaleDays: null,
      resolvedThisRun: [],
    });
    const critIdx = md.indexOf('🚨 Critical');
    const highIdx = md.indexOf('⚠️ High');
    const lowIdx = md.indexOf('📦 Low');
    expect(critIdx).toBeGreaterThan(0);
    expect(highIdx).toBeGreaterThan(critIdx);
    expect(lowIdx).toBeGreaterThan(highIdx);
  });

  test('sections with zero rows are hidden (no empty headers)', () => {
    const md = renderBoard({
      open: [gapFixture({ severity: 'critical' })],
      recentlyResolved: [],
      generatedAt: new Date('2026-05-05T12:00:00Z'),
      resolveStaleDays: null,
      resolvedThisRun: [],
    });
    expect(md).toContain('🚨 Critical');
    expect(md).not.toContain('⚠️ High');
    expect(md).not.toContain('📦 Low');
  });

  test('within bucket, most-recently-active first', () => {
    const newer = gapFixture({
      id: 'g_newer',
      severity: 'high',
      lastSeenAt: new Date('2026-05-05T11:00:00Z'),
    });
    const older = gapFixture({
      id: 'g_older',
      severity: 'high',
      lastSeenAt: new Date('2026-05-04T11:00:00Z'),
    });
    const md = renderBoard({
      open: [older, newer],
      recentlyResolved: [],
      generatedAt: new Date('2026-05-05T12:00:00Z'),
      resolveStaleDays: null,
      resolvedThisRun: [],
    });
    const newerIdx = md.indexOf('g_newer');
    const olderIdx = md.indexOf('g_older');
    expect(newerIdx).toBeGreaterThan(0);
    expect(olderIdx).toBeGreaterThan(0);
    expect(newerIdx).toBeLessThan(olderIdx);
  });

  test('recentlyResolved section appears only when non-empty', () => {
    const md = renderBoard({
      open: [gapFixture()],
      recentlyResolved: [
        gapFixture({
          id: 'g_done',
          status: 'resolved',
          resolvedAt: new Date('2026-05-04T12:00:00Z'),
          resolutionNote: 'Fixed the prompt typo.',
          resolutionPrUrl: 'https://github.com/example/sendero/pull/123',
        }),
      ],
      generatedAt: new Date('2026-05-05T12:00:00Z'),
      resolveStaleDays: null,
      resolvedThisRun: [],
    });
    expect(md).toContain('✅ Recently resolved');
    expect(md).toContain('Fixed the prompt typo');
    expect(md).toContain('([PR](https://github.com/example/sendero/pull/123))');
  });

  test('auto-resolve threshold notice surfaces the count of stale rows', () => {
    const md = renderBoard({
      open: [],
      recentlyResolved: [],
      generatedAt: new Date('2026-05-05T12:00:00Z'),
      resolveStaleDays: 14,
      resolvedThisRun: [gapFixture({ id: 'g_stale_1' }), gapFixture({ id: 'g_stale_2' })],
    });
    expect(md).toContain('Auto-resolve threshold: 14d');
    expect(md).toContain('auto-resolved 2 stale rows');
  });
});

describe('parseArgs — CLI ergonomics', () => {
  test('default since is 30 days ago', () => {
    const args = parseArgs([], '/tmp/test-board.md');
    const expected = Date.now() - 30 * 24 * 60 * 60 * 1000;
    expect(Math.abs(args.since.getTime() - expected)).toBeLessThan(2000);
  });

  test('--since YYYY-MM-DD parses correctly', () => {
    const args = parseArgs(['--since', '2026-04-01'], '/tmp/test-board.md');
    expect(args.since.toISOString().slice(0, 10)).toBe('2026-04-01');
  });

  test("--since with garbage throws (don't silently scan everything)", () => {
    expect(() => parseArgs(['--since', 'not-a-date'], '/tmp/test-board.md')).toThrow(/--since/);
  });

  test('--resolve-stale-days requires a positive integer', () => {
    expect(() => parseArgs(['--resolve-stale-days', '-5'], '/tmp/test-board.md')).toThrow();
    expect(() => parseArgs(['--resolve-stale-days', 'abc'], '/tmp/test-board.md')).toThrow();
    expect(parseArgs(['--resolve-stale-days', '14'], '/tmp/test-board.md').resolveStaleDays).toBe(
      14
    );
  });

  test('--tenant filters to a single tenant', () => {
    expect(parseArgs(['--tenant', 'org_abc'], '/tmp/test-board.md').tenant).toBe('org_abc');
    expect(parseArgs([], '/tmp/test-board.md').tenant).toBeNull();
  });

  test('--dry-run is a flag, not a value-flag', () => {
    expect(parseArgs(['--dry-run'], '/tmp/test-board.md').dryRun).toBe(true);
    expect(parseArgs([], '/tmp/test-board.md').dryRun).toBe(false);
  });
});
