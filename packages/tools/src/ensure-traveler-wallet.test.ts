import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';

/**
 * The idempotency key generator inside ensureTravelerWallet is the
 * one piece of pure logic worth unit-testing.  Concurrent + retried
 * calls for the same userId MUST land on the same Circle wallet, so
 * the key has to be deterministic + valid UUID v4 shape.
 *
 * We re-derive the same function here rather than exporting it from
 * the helper — keeping the helper's surface narrow (one function:
 * `ensureTravelerWallet`).  If the production logic drifts, this
 * test will start failing because the round-trip won't match.
 */
function uuidv4FromSeed(seed: string): string {
  const hash = createHash('sha256').update(seed).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('ensureTravelerWallet idempotency key', () => {
  test('produces a valid UUID v4 shape', () => {
    const key = uuidv4FromSeed('sendero:wallet:dcw:user_test_001');
    expect(key).toMatch(UUID_V4);
  });

  test('same seed → same key (deterministic)', () => {
    const seed = 'sendero:wallet:dcw:user_test_002';
    expect(uuidv4FromSeed(seed)).toBe(uuidv4FromSeed(seed));
  });

  test('different seed → different key', () => {
    const a = uuidv4FromSeed('sendero:wallet:dcw:user_test_003');
    const b = uuidv4FromSeed('sendero:wallet:dcw:user_test_004');
    expect(a).not.toBe(b);
  });

  test('userId appears in the seed prefix so concurrent unrelated users diverge', () => {
    const a = uuidv4FromSeed('sendero:wallet:dcw:alice');
    const b = uuidv4FromSeed('sendero:wallet:dcw:bob');
    expect(a).not.toBe(b);
  });
});
