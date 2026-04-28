/**
 * Tests for WhatsApp inbound dedup + replay-window gate.
 *
 * `isWithinReplayWindow` is pure (no Redis); `claimWhatsAppMessage`
 * mocks `./redis::getRedis` to drive SETNX semantics deterministically.
 *
 * Run: `bun test apps/app/lib/whatsapp-dedup.test.ts`
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

// ─────────────────────────────────────────────────────────────────────
// Module mock — installed before importing the unit under test
// ─────────────────────────────────────────────────────────────────────

interface FakeRedis {
  set: (key: string, value: string, opts?: { nx?: boolean; ex?: number }) => Promise<'OK' | null>;
  __store: Map<string, { value: string; expiresAt: number }>;
  __throw: { set: boolean };
}

function makeFakeRedis(): FakeRedis {
  const store = new Map<string, { value: string; expiresAt: number }>();
  const ctl = { set: false };
  return {
    __store: store,
    __throw: ctl,
    async set(key, value, opts) {
      if (ctl.set) throw new Error('set boom');
      const now = Date.now();
      const existing = store.get(key);
      if (existing && existing.expiresAt > now && opts?.nx) return null;
      store.set(key, {
        value,
        expiresAt: now + (opts?.ex ?? 60) * 1000,
      });
      return 'OK';
    },
  };
}

let fakeRedis: FakeRedis | null;

mock.module('./redis', () => ({
  getRedis: () => fakeRedis,
}));

const { claimWhatsAppMessage, isWithinReplayWindow } = await import('./whatsapp-dedup');

beforeEach(() => {
  fakeRedis = makeFakeRedis();
});

afterEach(() => {
  fakeRedis = null;
});

describe('isWithinReplayWindow', () => {
  const NOW = new Date('2026-04-27T12:00:00Z');

  test('current timestamp is within window', () => {
    expect(isWithinReplayWindow(NOW, NOW)).toBe(true);
  });

  test('1 minute in the past is within window', () => {
    const past = new Date(NOW.getTime() - 60 * 1000);
    expect(isWithinReplayWindow(past, NOW)).toBe(true);
  });

  test('4 minutes in the past is within window', () => {
    const past = new Date(NOW.getTime() - 4 * 60 * 1000);
    expect(isWithinReplayWindow(past, NOW)).toBe(true);
  });

  test('6 minutes in the past is OUTSIDE window', () => {
    const past = new Date(NOW.getTime() - 6 * 60 * 1000);
    expect(isWithinReplayWindow(past, NOW)).toBe(false);
  });

  test('30 seconds in the future is within window (clock skew tolerance)', () => {
    const future = new Date(NOW.getTime() + 30 * 1000);
    expect(isWithinReplayWindow(future, NOW)).toBe(true);
  });

  test('10 minutes in the future is OUTSIDE window', () => {
    const future = new Date(NOW.getTime() + 10 * 60 * 1000);
    expect(isWithinReplayWindow(future, NOW)).toBe(false);
  });
});

describe('claimWhatsAppMessage', () => {
  test('first claim returns true and second returns false', async () => {
    expect(await claimWhatsAppMessage('wamid.ABC')).toBe(true);
    expect(await claimWhatsAppMessage('wamid.ABC')).toBe(false);
  });

  test('different wamids do not collide', async () => {
    expect(await claimWhatsAppMessage('wamid.A')).toBe(true);
    expect(await claimWhatsAppMessage('wamid.B')).toBe(true);
  });

  test('null/undefined messageId fails open (returns true, no Redis write)', async () => {
    expect(await claimWhatsAppMessage(null)).toBe(true);
    expect(await claimWhatsAppMessage(undefined)).toBe(true);
    expect(fakeRedis!.__store.size).toBe(0);
  });

  test('Redis unavailable fails open (returns true)', async () => {
    fakeRedis = null;
    expect(await claimWhatsAppMessage('wamid.X')).toBe(true);
  });

  test('Redis throwing fails open with logged error', async () => {
    fakeRedis!.__throw.set = true;
    expect(await claimWhatsAppMessage('wamid.X')).toBe(true);
  });
});
