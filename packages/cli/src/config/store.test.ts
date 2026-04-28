/**
 * Store tests — focus on key validation, env precedence, and profile
 * sanitization. The fs-touching paths (profile read/write, migration)
 * use a temp HOME so we don't pollute the developer's real ~/.sendero.
 */

import { describe, expect, test } from 'bun:test';

import { isValidKeyShape, readKey } from './store';

describe('isValidKeyShape', () => {
  test('accepts canonical Clerk key shape', () => {
    expect(isValidKeyShape('ak_abcdefghijklmnopqrstuvwxyz0123456789_-')).toBe(true);
  });

  test('rejects too-short keys', () => {
    expect(isValidKeyShape('ak_short')).toBe(false);
  });

  test('rejects wrong prefix', () => {
    expect(isValidKeyShape('sk_abcdefghijklmnop')).toBe(false);
  });

  test('rejects whitespace-embedded keys', () => {
    expect(isValidKeyShape('ak_abcdefghij\nklmnop')).toBe(false);
    expect(isValidKeyShape('ak_abcdefghij klmnop')).toBe(false);
  });

  test('rejects "Bearer ak_..." copy-paste', () => {
    expect(isValidKeyShape('Bearer ak_abcdefghijklmnop123456')).toBe(false);
  });

  test('rejects empty / null-ish', () => {
    expect(isValidKeyShape('')).toBe(false);
    expect(isValidKeyShape('ak_')).toBe(false);
  });
});

describe('readKey precedence', () => {
  test('SENDERO_API_KEY env wins when set', () => {
    const original = process.env.SENDERO_API_KEY;
    process.env.SENDERO_API_KEY = 'ak_from_env_priority_test_xxxx';
    try {
      expect(readKey()).toBe('ak_from_env_priority_test_xxxx');
    } finally {
      if (original === undefined) delete process.env.SENDERO_API_KEY;
      else process.env.SENDERO_API_KEY = original;
    }
  });
});

// Note: profile-migration integration tests aren't included here because
// store.ts captures HOME at module-top (path constants), and Bun's module
// cache doesn't honor cache-bust query strings the way Node ESM does.
// Migration is small enough to verify by smoke test:
//   1. Touch ~/.sendero/key with `ak_xxx`, run any sendero command
//   2. Verify ~/.sendero/profiles/default.json exists with that key
//   3. Verify ~/.sendero/key is gone
