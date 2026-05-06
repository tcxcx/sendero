/**
 * promote.ts — focused unit tests on the pure helpers.
 *
 * The REST orchestration (Phoenix dataset upload, idempotency diff)
 * is exercised by the cron route handlers in apps/app and verified
 * end-to-end against Phoenix Cloud after deploy. Here we lock down
 * the must-mention heuristic, which is the only non-trivial pure
 * function in the module and most likely to drift on text changes.
 */

import { describe, expect, test } from 'bun:test';

import { extractMustMention_test as extractMustMention } from './promote';

describe('extractMustMention', () => {
  test('includes the toolName when provided', () => {
    expect(extractMustMention('something happened', 'scan_document')).toContain('scan_document');
  });

  test('extracts camelCase identifiers ≥ 4 chars', () => {
    const out = extractMustMention('Tool wants documentUrl, not documentImageUrl', null);
    expect(out).toContain('documentUrl');
    expect(out).toContain('documentImageUrl');
  });

  test('extracts snake_case identifiers ≥ 4 chars', () => {
    const out = extractMustMention(
      'Use scan_passport_inline for passport intake on this corridor.',
      null
    );
    expect(out).toContain('scan_passport_inline');
  });

  test('extracts ALL_CAPS identifiers ≥ 4 chars', () => {
    const out = extractMustMention(
      'Redeploy after PASSPORT_VAULT_KEK env-add — the env binding only flows on next deploy.',
      null
    );
    expect(out).toContain('PASSPORT_VAULT_KEK');
  });

  test('does not include common English words even when ≥ 4 chars', () => {
    const out = extractMustMention('This tool failed because the field name was wrong.', null);
    // bare lowercase words (no camel/snake/caps) are not identifier-shaped → excluded
    for (const word of ['this', 'tool', 'failed', 'because', 'field', 'name', 'wrong']) {
      expect(out).not.toContain(word);
    }
  });

  test('caps result at 6 tokens to keep agent prompt tight', () => {
    const long =
      'Use documentUrl, documentImageUrl, fooBar, FOO_BAR, snake_case_one, snake_case_two, and CAMEL_CASE_X';
    const out = extractMustMention(long, 'scan_document');
    expect(out.length).toBeLessThanOrEqual(6);
  });

  test('dedups identical tokens', () => {
    const out = extractMustMention('documentUrl appears here, and documentUrl again', null);
    const count = out.filter(t => t === 'documentUrl').length;
    expect(count).toBe(1);
  });
});
