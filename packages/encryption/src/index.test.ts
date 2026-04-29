/**
 * AES-256-GCM roundtrip + tamper-detection coverage for the Gateway
 * signer encryption path. Phase 5 widened the API to async to support
 * Google Cloud KMS-backed KEK loading; tests track that change.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { _clearKekCache, decrypt, deriveDek, encrypt } from './index';

const TEST_KEK_B64 = Buffer.alloc(32, 0x42).toString('base64');

beforeAll(() => {
  process.env.SENDERO_KEK = TEST_KEK_B64;
});

afterAll(() => {
  delete process.env.SENDERO_KEK;
});

afterEach(() => {
  _clearKekCache();
});

describe('encrypt / decrypt roundtrip', () => {
  test('plaintext survives a round-trip through encrypt + decrypt', async () => {
    const { ciphertext, kekVersion } = await encrypt({
      plaintext: '0xdeadbeef',
      purpose: 'gateway-signer',
      contextId: 'tenant-abc',
    });
    const out = await decrypt({
      ciphertext,
      purpose: 'gateway-signer',
      contextId: 'tenant-abc',
      kekVersion,
    });
    expect(out).toBe('0xdeadbeef');
  });

  test('returns the kekVersion used for encryption', async () => {
    const { kekVersion } = await encrypt({
      plaintext: 'x',
      purpose: 'gateway-signer',
      contextId: 'tenant-abc',
    });
    expect(kekVersion).toBe(1);
  });

  test('two encryptions of the same plaintext produce different ciphertexts (random IV)', async () => {
    const a = await encrypt({ plaintext: 'x', purpose: 'gateway-signer', contextId: 'tenant-a' });
    const b = await encrypt({ plaintext: 'x', purpose: 'gateway-signer', contextId: 'tenant-a' });
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });
});

describe('tamper detection', () => {
  test('ciphertext modification fails authentication', async () => {
    const { ciphertext, kekVersion } = await encrypt({
      plaintext: 'secret',
      purpose: 'gateway-signer',
      contextId: 'tenant-a',
    });
    const buf = Buffer.from(ciphertext, 'base64');
    buf[20] ^= 0xff;
    const tampered = buf.toString('base64');
    expect(
      decrypt({
        ciphertext: tampered,
        purpose: 'gateway-signer',
        contextId: 'tenant-a',
        kekVersion,
      })
    ).rejects.toThrow('authentication failed');
  });

  test('wrong contextId fails authentication (no info leak)', async () => {
    const { ciphertext, kekVersion } = await encrypt({
      plaintext: 'secret',
      purpose: 'gateway-signer',
      contextId: 'tenant-a',
    });
    expect(
      decrypt({
        ciphertext,
        purpose: 'gateway-signer',
        contextId: 'tenant-b',
        kekVersion,
      })
    ).rejects.toThrow('authentication failed');
  });

  test('wrong purpose fails authentication', async () => {
    const { ciphertext, kekVersion } = await encrypt({
      plaintext: 'secret',
      purpose: 'gateway-signer',
      contextId: 'tenant-a',
    });
    expect(
      decrypt({
        ciphertext,
        purpose: 'slack-oauth',
        contextId: 'tenant-a',
        kekVersion,
      })
    ).rejects.toThrow('authentication failed');
  });

  test('truncated ciphertext rejected', async () => {
    expect(
      decrypt({
        ciphertext: 'aGVsbG8=',
        purpose: 'gateway-signer',
        contextId: 'tenant-a',
        kekVersion: 1,
      })
    ).rejects.toThrow('too short');
  });
});

describe('KEK loading (env mode)', () => {
  test('missing KEK env throws with actionable message', async () => {
    delete process.env.SENDERO_KEK;
    expect(
      encrypt({ plaintext: 'x', purpose: 'gateway-signer', contextId: 'a' })
    ).rejects.toThrow(/SENDERO_KEK is not set/);
    process.env.SENDERO_KEK = TEST_KEK_B64;
  });

  test('non-base64 KEK throws', async () => {
    process.env.SENDERO_KEK = 'not!valid!base64!';
    expect(
      encrypt({ plaintext: 'x', purpose: 'gateway-signer', contextId: 'a' })
    ).rejects.toThrow();
    process.env.SENDERO_KEK = TEST_KEK_B64;
  });

  test('wrong-length KEK throws', async () => {
    process.env.SENDERO_KEK = Buffer.alloc(16, 0).toString('base64');
    expect(
      encrypt({ plaintext: 'x', purpose: 'gateway-signer', contextId: 'a' })
    ).rejects.toThrow(/32 bytes/);
    process.env.SENDERO_KEK = TEST_KEK_B64;
  });
});

describe('KMS mode wiring', () => {
  test('gcp-kms provider without ciphertext env throws actionable error', async () => {
    process.env.SENDERO_KEK_PROVIDER = 'gcp-kms';
    delete process.env.SENDERO_KEK_CIPHERTEXT;
    delete process.env.SENDERO_KEK_KMS_RESOURCE;
    expect(
      encrypt({ plaintext: 'x', purpose: 'gateway-signer', contextId: 'a' })
    ).rejects.toThrow(/SENDERO_KEK_CIPHERTEXT is not set/);
    delete process.env.SENDERO_KEK_PROVIDER;
  });

  test('gcp-kms provider with ciphertext but no resource env throws', async () => {
    process.env.SENDERO_KEK_PROVIDER = 'gcp-kms';
    process.env.SENDERO_KEK_CIPHERTEXT = 'AAAA';
    delete process.env.SENDERO_KEK_KMS_RESOURCE;
    expect(
      encrypt({ plaintext: 'x', purpose: 'gateway-signer', contextId: 'a' })
    ).rejects.toThrow(/SENDERO_KEK_KMS_RESOURCE is not set/);
    delete process.env.SENDERO_KEK_PROVIDER;
    delete process.env.SENDERO_KEK_CIPHERTEXT;
  });
});

describe('DEK derivation determinism', () => {
  test('same inputs produce same DEK', async () => {
    const a = await deriveDek('gateway-signer', 'tenant-x');
    const b = await deriveDek('gateway-signer', 'tenant-x');
    expect(a.equals(b)).toBe(true);
  });

  test('different tenants produce different DEKs', async () => {
    const a = await deriveDek('gateway-signer', 'tenant-x');
    const b = await deriveDek('gateway-signer', 'tenant-y');
    expect(a.equals(b)).toBe(false);
  });

  test('different purposes produce different DEKs', async () => {
    const a = await deriveDek('gateway-signer', 'tenant-x');
    const b = await deriveDek('slack-oauth', 'tenant-x');
    expect(a.equals(b)).toBe(false);
  });
});
