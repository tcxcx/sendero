/**
 * Tests for the resend auth token verifier (track-G-auth).
 *
 * Coverage matrix:
 *   - Happy path: valid token from the trip's keypair → ok
 *   - Token signed by a different key → pubkey_mismatch
 *   - Expired token → expired
 *   - Replayed nonce (same token twice) → replayed on second call
 *   - Malformed token → malformed
 *   - Missing trip on chain → trip_not_found
 *   - Tampered signature (one byte flipped) → bad_signature OR pubkey_mismatch
 *
 * The on-chain pubkey resolver and the dedup store are injected so
 * the test suite stays hermetic — no viem RPC, no Upstash.
 */

import { describe, expect, test } from 'bun:test';
import {
  generateClaimKeypair,
  generateResendAuthNonce,
  signResendAuthToken,
  type ClaimKeypair,
} from '@sendero/guest';
import type { Address, Hex } from 'viem';

import { verifyResendAuthToken } from './resend-auth';

const TRIP_ID: Hex = `0x${'1'.repeat(64)}` as Hex;

function makeMemoryDedup() {
  const seen = new Set<string>();
  return {
    async setnxEx(key: string): Promise<boolean> {
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    },
  };
}

async function buildToken(kp: ClaimKeypair, opts: { exp?: number } = {}) {
  const nonce = generateResendAuthNonce();
  const token = await signResendAuthToken({
    claimPrivateKey: kp.privateKey,
    tripId: TRIP_ID,
    nonce,
    expSec: opts.exp,
  });
  return { token, nonce };
}

describe('verifyResendAuthToken', () => {
  test('happy path — valid token from trip keypair returns ok', async () => {
    const kp = generateClaimKeypair();
    const { token } = await buildToken(kp);
    const verdict = await verifyResendAuthToken({
      token,
      onchainTripId: TRIP_ID,
      resolvePubKey: async () => kp.pubKey20,
      redis: makeMemoryDedup(),
    });
    expect(verdict).toEqual({ ok: true });
  });

  test('token signed by a different key → pubkey_mismatch', async () => {
    const realKp = generateClaimKeypair();
    const attackerKp = generateClaimKeypair();
    const { token } = await buildToken(attackerKp);
    const verdict = await verifyResendAuthToken({
      token,
      onchainTripId: TRIP_ID,
      resolvePubKey: async () => realKp.pubKey20,
      redis: makeMemoryDedup(),
    });
    expect(verdict).toEqual({ ok: false, reason: 'pubkey_mismatch' });
  });

  test('expired token → expired', async () => {
    const kp = generateClaimKeypair();
    const past = Math.floor(Date.now() / 1000) - 1;
    const { token } = await buildToken(kp, { exp: past });
    const verdict = await verifyResendAuthToken({
      token,
      onchainTripId: TRIP_ID,
      resolvePubKey: async () => kp.pubKey20,
      redis: makeMemoryDedup(),
    });
    expect(verdict).toEqual({ ok: false, reason: 'expired' });
  });

  test('replayed nonce → replayed on second call', async () => {
    const kp = generateClaimKeypair();
    const { token } = await buildToken(kp);
    const dedup = makeMemoryDedup();
    const v1 = await verifyResendAuthToken({
      token,
      onchainTripId: TRIP_ID,
      resolvePubKey: async () => kp.pubKey20,
      redis: dedup,
    });
    expect(v1).toEqual({ ok: true });
    const v2 = await verifyResendAuthToken({
      token,
      onchainTripId: TRIP_ID,
      resolvePubKey: async () => kp.pubKey20,
      redis: dedup,
    });
    expect(v2).toEqual({ ok: false, reason: 'replayed' });
  });

  test('malformed token (bad base64) → malformed', async () => {
    const kp = generateClaimKeypair();
    const verdict = await verifyResendAuthToken({
      token: 'not-a-base64-token!!!',
      onchainTripId: TRIP_ID,
      resolvePubKey: async () => kp.pubKey20,
      redis: makeMemoryDedup(),
    });
    expect(verdict).toEqual({ ok: false, reason: 'malformed' });
  });

  test('trip not found on chain → trip_not_found', async () => {
    process.env.ARC_ESCROW_ADDRESS = '0x0000000000000000000000000000000000000001';
    const kp = generateClaimKeypair();
    const { token } = await buildToken(kp);
    const verdict = await verifyResendAuthToken({
      token,
      onchainTripId: TRIP_ID,
      resolvePubKey: async () => null,
      redis: makeMemoryDedup(),
    });
    expect(verdict).toEqual({ ok: false, reason: 'trip_not_found' });
  });

  test('tampered signature → bad_signature OR pubkey_mismatch', async () => {
    const kp = generateClaimKeypair();
    const { token } = await buildToken(kp);
    // Decode, flip a byte in the signature, re-encode.
    const decoded = Buffer.from(token.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
      'utf8'
    );
    const payload = JSON.parse(decoded) as { signature: string; nonce: string; exp: number };
    // Flip the last hex char of the signature. Most flips will recover
    // a different address (pubkey_mismatch); some will be invalid r/s
    // values (bad_signature). Either is a valid rejection.
    const flipped =
      payload.signature.slice(0, -1) + (payload.signature.slice(-1) === 'a' ? 'b' : 'a');
    payload.signature = flipped;
    const tampered = Buffer.from(JSON.stringify(payload))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const verdict = await verifyResendAuthToken({
      token: tampered,
      onchainTripId: TRIP_ID,
      resolvePubKey: async () => kp.pubKey20,
      redis: makeMemoryDedup(),
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(['bad_signature', 'pubkey_mismatch']).toContain(verdict.reason);
    }
  });
});
