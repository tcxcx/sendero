/**
 * Tests for Slack thread-subscription tracking.
 *
 * Mocks `./redis::getRedis` to drive Redis SET/GET semantics
 * deterministically. The fail-open behavior on Redis-unavailable is
 * tested explicitly because it's safety-critical (a Redis outage must
 * not flip the bot into a #general firehose).
 *
 * Run: `bun test apps/app/lib/slack-thread-subscription.test.ts`
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

interface FakeRedis {
  set: (key: string, value: string, opts?: { ex?: number }) => Promise<'OK' | null>;
  get: (key: string) => Promise<string | null>;
  __store: Map<string, { value: string; expiresAt: number }>;
  __throw: { set: boolean; get: boolean };
}

function makeFakeRedis(): FakeRedis {
  const store = new Map<string, { value: string; expiresAt: number }>();
  const ctl = { set: false, get: false };
  return {
    __store: store,
    __throw: ctl,
    async set(key, value, opts) {
      if (ctl.set) throw new Error('set boom');
      store.set(key, { value, expiresAt: Date.now() + (opts?.ex ?? 60) * 1000 });
      return 'OK';
    },
    async get(key) {
      if (ctl.get) throw new Error('get boom');
      const cur = store.get(key);
      if (!cur) return null;
      if (cur.expiresAt <= Date.now()) {
        store.delete(key);
        return null;
      }
      return cur.value;
    },
  };
}

let fakeRedis: FakeRedis | null;

mock.module('./redis', () => ({
  getRedis: () => fakeRedis,
}));

const { isThreadSubscribed, markThreadSubscribed } = await import('./slack-thread-subscription');

beforeEach(() => {
  fakeRedis = makeFakeRedis();
});

afterEach(() => {
  fakeRedis = null;
});

describe('markThreadSubscribed + isThreadSubscribed', () => {
  test('mark then check returns true', async () => {
    await markThreadSubscribed({
      teamId: 'T1',
      channelId: 'C1',
      threadTs: '1700000000.0',
    });
    const subscribed = await isThreadSubscribed({
      teamId: 'T1',
      channelId: 'C1',
      threadTs: '1700000000.0',
    });
    expect(subscribed).toBe(true);
  });

  test('unrelated thread returns false', async () => {
    await markThreadSubscribed({
      teamId: 'T1',
      channelId: 'C1',
      threadTs: '1700000000.0',
    });
    const otherSubscribed = await isThreadSubscribed({
      teamId: 'T1',
      channelId: 'C2',
      threadTs: '1700000000.0',
    });
    expect(otherSubscribed).toBe(false);
  });

  test('different team scopes do not collide', async () => {
    await markThreadSubscribed({
      teamId: 'T1',
      channelId: 'C1',
      threadTs: '1.0',
    });
    expect(await isThreadSubscribed({ teamId: 'T2', channelId: 'C1', threadTs: '1.0' })).toBe(
      false
    );
  });

  test('Redis unavailable: mark is silent, check returns false (fail-conservative)', async () => {
    fakeRedis = null;
    // Mark must not throw.
    await markThreadSubscribed({
      teamId: 'T1',
      channelId: 'C1',
      threadTs: '1.0',
    });
    // Check returns false — bot falls back to @-mention-only mode.
    const subscribed = await isThreadSubscribed({
      teamId: 'T1',
      channelId: 'C1',
      threadTs: '1.0',
    });
    expect(subscribed).toBe(false);
  });

  test('Redis throwing on set is non-fatal', async () => {
    fakeRedis!.__throw.set = true;
    await markThreadSubscribed({
      teamId: 'T1',
      channelId: 'C1',
      threadTs: '1.0',
    });
    // No throw, no abort.
  });

  test('Redis throwing on get returns false (fail-conservative)', async () => {
    await markThreadSubscribed({
      teamId: 'T1',
      channelId: 'C1',
      threadTs: '1.0',
    });
    fakeRedis!.__throw.get = true;
    const subscribed = await isThreadSubscribed({
      teamId: 'T1',
      channelId: 'C1',
      threadTs: '1.0',
    });
    expect(subscribed).toBe(false);
  });
});
