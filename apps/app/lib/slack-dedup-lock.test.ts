/**
 * Tests for Slack dedup + thread single-flight lock.
 *
 * Mocks `./redis::getRedis` at module level so we can drive the
 * SETNX semantics deterministically. The "fail-open when Redis is
 * null" path is covered separately by setting the mock to return null.
 *
 * Run: `bun test apps/app/lib/slack-dedup-lock.test.ts`
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

// ─────────────────────────────────────────────────────────────────────
// Module mock — installed before importing the unit under test
// ─────────────────────────────────────────────────────────────────────

interface FakeRedis {
  set: (key: string, value: string, opts?: { nx?: boolean; ex?: number }) => Promise<'OK' | null>;
  eval: (script: string, keys: string[], args: string[]) => Promise<number>;
  // Test-only inspectors:
  __store: Map<string, { value: string; expiresAt: number }>;
  __throw: { set: boolean; eval: boolean };
}

function makeFakeRedis(): FakeRedis {
  const store = new Map<string, { value: string; expiresAt: number }>();
  const ctl = { set: false, eval: false };
  return {
    __store: store,
    __throw: ctl,
    async set(key, value, opts) {
      if (ctl.set) throw new Error('set boom');
      const now = Date.now();
      const existing = store.get(key);
      if (existing && existing.expiresAt > now) {
        if (opts?.nx) return null;
      }
      store.set(key, {
        value,
        expiresAt: now + (opts?.ex ?? 60) * 1000,
      });
      return 'OK';
    },
    async eval(_script, keys, args) {
      if (ctl.eval) throw new Error('eval boom');
      const [key] = keys;
      const [token] = args;
      if (!key) return 0;
      const cur = store.get(key);
      if (cur && cur.value === token) {
        store.delete(key);
        return 1;
      }
      return 0;
    },
  };
}

let fakeRedis: FakeRedis | null;

mock.module('./redis', () => ({
  getRedis: () => fakeRedis,
}));

// Import AFTER the mock is registered so the unit under test sees the
// mocked `getRedis`.
const { acquireThreadLock, claimSlackEvent, releaseThreadLock } = await import(
  './slack-dedup-lock'
);

beforeEach(() => {
  fakeRedis = makeFakeRedis();
});

afterEach(() => {
  fakeRedis = null;
});

describe('claimSlackEvent', () => {
  test('first claim returns true and second returns false', async () => {
    expect(await claimSlackEvent('Ev_123')).toBe(true);
    expect(await claimSlackEvent('Ev_123')).toBe(false);
  });

  test('different event_ids do not collide', async () => {
    expect(await claimSlackEvent('Ev_AAA')).toBe(true);
    expect(await claimSlackEvent('Ev_BBB')).toBe(true);
  });

  test('null/undefined eventId fails open (returns true, no Redis write)', async () => {
    expect(await claimSlackEvent(null)).toBe(true);
    expect(await claimSlackEvent(undefined)).toBe(true);
    expect(fakeRedis!.__store.size).toBe(0);
  });

  test('Redis unavailable fails open (returns true)', async () => {
    fakeRedis = null;
    expect(await claimSlackEvent('Ev_123')).toBe(true);
  });

  test('Redis throwing fails open with logged error', async () => {
    fakeRedis!.__throw.set = true;
    expect(await claimSlackEvent('Ev_123')).toBe(true);
  });
});

describe('acquireThreadLock + releaseThreadLock', () => {
  test('first acquire returns a token, concurrent acquire returns null', async () => {
    const tok1 = await acquireThreadLock('slack:T1:C1:1700000000.0');
    expect(typeof tok1).toBe('string');
    expect(tok1).not.toBe('__fail_open__');

    const tok2 = await acquireThreadLock('slack:T1:C1:1700000000.0');
    expect(tok2).toBeNull();
  });

  test('different subjectKeys do not block each other', async () => {
    const tokA = await acquireThreadLock('slack:T1:C1:1');
    const tokB = await acquireThreadLock('slack:T1:C2:1');
    expect(tokA).not.toBeNull();
    expect(tokB).not.toBeNull();
  });

  test('release allows re-acquire on same key', async () => {
    const tok1 = await acquireThreadLock('slack:T1:C1:1');
    expect(tok1).not.toBeNull();

    await releaseThreadLock('slack:T1:C1:1', tok1);

    const tok2 = await acquireThreadLock('slack:T1:C1:1');
    expect(tok2).not.toBeNull();
    expect(tok2).not.toBe(tok1);
  });

  test('release with wrong token does NOT free the lock', async () => {
    const tok1 = await acquireThreadLock('slack:T1:C1:1');
    expect(tok1).not.toBeNull();

    await releaseThreadLock('slack:T1:C1:1', 'forged-token');

    // Lock still held — original holder retains it.
    const tok2 = await acquireThreadLock('slack:T1:C1:1');
    expect(tok2).toBeNull();
  });

  test('release with null token is a no-op', async () => {
    await releaseThreadLock('slack:T1:C1:1', null);
    // No throw, no state change.
    expect(fakeRedis!.__store.size).toBe(0);
  });

  test('Redis unavailable returns fail-open sentinel; release is a no-op', async () => {
    fakeRedis = null;
    const tok = await acquireThreadLock('slack:T1:C1:1');
    expect(tok).toBe('__fail_open__');
    // Release with sentinel must not throw and must not need Redis.
    await releaseThreadLock('slack:T1:C1:1', tok);
  });

  test('Redis throwing on acquire returns fail-open sentinel', async () => {
    fakeRedis!.__throw.set = true;
    const tok = await acquireThreadLock('slack:T1:C1:1');
    expect(tok).toBe('__fail_open__');
  });

  test('release tolerates Redis throwing', async () => {
    const tok = await acquireThreadLock('slack:T1:C1:1');
    expect(tok).not.toBeNull();
    fakeRedis!.__throw.eval = true;
    // Should not throw out.
    await releaseThreadLock('slack:T1:C1:1', tok);
  });
});
