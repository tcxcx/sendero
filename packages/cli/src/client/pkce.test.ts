/**
 * PKCE helper tests. These cover the cryptographic primitives — if the
 * verifier / challenge derivation drifts from RFC 7636, every OAuth
 * round-trip silently fails. Cheap to test, expensive to debug if wrong.
 */

import { createHash } from 'node:crypto';
import { describe, expect, test } from 'bun:test';

import { deriveCodeChallenge, generateCodeVerifier, generateState } from './pkce';

describe('generateCodeVerifier', () => {
  test('produces base64url, no padding, RFC-compliant length', () => {
    const v = generateCodeVerifier();
    expect(v.length).toBeGreaterThanOrEqual(43);
    expect(v.length).toBeLessThanOrEqual(128);
    // base64url: A-Z a-z 0-9 - _, no = padding
    expect(v).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(v).not.toContain('=');
  });

  test('is unique per call (entropy check)', () => {
    const a = generateCodeVerifier();
    const b = generateCodeVerifier();
    expect(a).not.toBe(b);
  });
});

describe('deriveCodeChallenge', () => {
  test('matches SHA256(verifier) base64url', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const expected = createHash('sha256').update(verifier).digest('base64url');
    expect(deriveCodeChallenge(verifier)).toBe(expected);
  });

  test('output is 43 chars (SHA256 → 32 bytes → base64url no padding)', () => {
    const challenge = deriveCodeChallenge('any-verifier-here');
    expect(challenge.length).toBe(43);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test('different verifiers yield different challenges', () => {
    expect(deriveCodeChallenge('one')).not.toBe(deriveCodeChallenge('two'));
  });
});

describe('generateState', () => {
  test('is base64url and unique', () => {
    const s = generateState();
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(s.length).toBeGreaterThanOrEqual(20);
    expect(s).not.toBe(generateState());
  });
});
