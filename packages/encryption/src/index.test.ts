/**
 * AES-256-GCM roundtrip + tamper-detection coverage for the Gateway
 * signer encryption path. These tests run in-process with a deterministic
 * KEK so the wire format stays stable across migrations.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { decrypt, deriveDek, encrypt } from './index';

const TEST_KEK_B64 = Buffer.alloc(32, 0x42).toString('base64');

beforeAll(() => {
  process.env.SENDERO_KEK = TEST_KEK_B64;
});

afterAll(() => {
  delete process.env.SENDERO_KEK;
});

describe('encrypt / decrypt roundtrip', () => {
  test('plaintext survives a round-trip through encrypt + decrypt', () => {
    const { ciphertext, kekVersion } = encrypt({
      plaintext: '0xdeadbeef',
      purpose: 'gateway-signer',
      contextId: 'tenant-abc',
    });
    const out = decrypt({
      ciphertext,
      purpose: 'gateway-signer',
      contextId: 'tenant-abc',
      kekVersion,
    });
    expect(out).toBe('0xdeadbeef');
  });

  test('returns the kekVersion used for encryption', () => {
    const { kekVersion } = encrypt({
      plaintext: 'x',
      purpose: 'gateway-signer',
      contextId: 'tenant-abc',
    });
    expect(kekVersion).toBe(1);
  });

  test('two encryptions of the same plaintext produce different ciphertexts (random IV)', () => {
    const a = encrypt({ plaintext: 'x', purpose: 'gateway-signer', contextId: 'tenant-a' });
    const b = encrypt({ plaintext: 'x', purpose: 'gateway-signer', contextId: 'tenant-a' });
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });
});

describe('tamper detection', () => {
  test('ciphertext modification fails authentication', () => {
    const { ciphertext, kekVersion } = encrypt({
      plaintext: 'secret',
      purpose: 'gateway-signer',
      contextId: 'tenant-a',
    });
    // Flip a byte in the middle of the ciphertext.
    const buf = Buffer.from(ciphertext, 'base64');
    buf[20] ^= 0xff;
    const tampered = buf.toString('base64');
    expect(() =>
      decrypt({
        ciphertext: tampered,
        purpose: 'gateway-signer',
        contextId: 'tenant-a',
        kekVersion,
      })
    ).toThrow('authentication failed');
  });

  test('wrong contextId fails authentication (no info leak)', () => {
    const { ciphertext, kekVersion } = encrypt({
      plaintext: 'secret',
      purpose: 'gateway-signer',
      contextId: 'tenant-a',
    });
    expect(() =>
      decrypt({
        ciphertext,
        purpose: 'gateway-signer',
        contextId: 'tenant-b',
        kekVersion,
      })
    ).toThrow('authentication failed');
  });

  test('wrong purpose fails authentication', () => {
    const { ciphertext, kekVersion } = encrypt({
      plaintext: 'secret',
      purpose: 'gateway-signer',
      contextId: 'tenant-a',
    });
    expect(() =>
      decrypt({
        ciphertext,
        purpose: 'slack-oauth',
        contextId: 'tenant-a',
        kekVersion,
      })
    ).toThrow('authentication failed');
  });

  test('truncated ciphertext rejected', () => {
    expect(() =>
      decrypt({
        ciphertext: 'aGVsbG8=', // base64 'hello' — too short
        purpose: 'gateway-signer',
        contextId: 'tenant-a',
        kekVersion: 1,
      })
    ).toThrow('too short');
  });
});

describe('KEK loading', () => {
  test('missing KEK env throws with actionable message', () => {
    delete process.env.SENDERO_KEK;
    expect(() =>
      encrypt({ plaintext: 'x', purpose: 'gateway-signer', contextId: 'a' })
    ).toThrow(/SENDERO_KEK is not set/);
    process.env.SENDERO_KEK = TEST_KEK_B64;
  });

  test('non-base64 KEK throws', () => {
    process.env.SENDERO_KEK = 'not!valid!base64!';
    expect(() =>
      encrypt({ plaintext: 'x', purpose: 'gateway-signer', contextId: 'a' })
    ).toThrow();
    process.env.SENDERO_KEK = TEST_KEK_B64;
  });

  test('wrong-length KEK throws', () => {
    process.env.SENDERO_KEK = Buffer.alloc(16, 0).toString('base64'); // 16 bytes, not 32
    expect(() =>
      encrypt({ plaintext: 'x', purpose: 'gateway-signer', contextId: 'a' })
    ).toThrow(/32 bytes/);
    process.env.SENDERO_KEK = TEST_KEK_B64;
  });
});

describe('DEK derivation determinism', () => {
  test('same inputs produce same DEK', () => {
    const a = deriveDek('gateway-signer', 'tenant-x');
    const b = deriveDek('gateway-signer', 'tenant-x');
    expect(a.equals(b)).toBe(true);
  });

  test('different tenants produce different DEKs', () => {
    const a = deriveDek('gateway-signer', 'tenant-x');
    const b = deriveDek('gateway-signer', 'tenant-y');
    expect(a.equals(b)).toBe(false);
  });

  test('different purposes produce different DEKs', () => {
    const a = deriveDek('gateway-signer', 'tenant-x');
    const b = deriveDek('slack-oauth', 'tenant-x');
    expect(a.equals(b)).toBe(false);
  });
});
