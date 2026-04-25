/**
 * Tests for the operator-keyed on-chain submitter.
 *
 * The submitter wraps viem walletClient + publicClient calls — those
 * are infra we trust. The interesting surface is:
 *   - env validation (missing/malformed key, missing escrow address)
 *   - error decoding (contract revert vs RPC failure)
 *   - cache reset between tests
 *
 * Real on-chain behavior is exercised by the Foundry suite + the
 * smoke harness (`scripts/smoke-guest-escrow.ts`); this file pins
 * the failure-mode contract that route handlers depend on.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  _resetOperatorWalletCache,
  submitCancelTrip,
  submitSetClaimCodeHash,
  submitSweepUnspent,
} from './operator-submit';

const VALID_TRIP_ID = `0x${'1'.repeat(64)}` as const;
const VALID_CODE_HASH = `0x${'2'.repeat(64)}` as const;

const STASH: Record<string, string | undefined> = {};
const ENV_KEYS = [
  'OPERATOR_PRIVATE_KEY',
  'ARC_OPERATOR_PRIVATE_KEY',
  'ARC_ESCROW_ADDRESS',
  'NEXT_PUBLIC_ARC_ESCROW_ADDRESS',
  'NEXT_PUBLIC_SENDERO_GUEST_ESCROW',
];

beforeEach(() => {
  for (const k of ENV_KEYS) {
    STASH[k] = process.env[k];
    delete process.env[k];
  }
  _resetOperatorWalletCache();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (STASH[k] === undefined) delete process.env[k];
    else process.env[k] = STASH[k];
  }
  _resetOperatorWalletCache();
});

describe('operator-submit env validation', () => {
  test('returns operator_key_unavailable when OPERATOR_PRIVATE_KEY is unset', async () => {
    process.env.ARC_ESCROW_ADDRESS = `0x${'a'.repeat(40)}`;
    const result = await submitSetClaimCodeHash({
      onchainTripId: VALID_TRIP_ID,
      newCodeHash: VALID_CODE_HASH,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('operator_key_unavailable');
      expect(result.message).toContain('OPERATOR_PRIVATE_KEY');
    }
  });

  test('returns operator_key_unavailable when OPERATOR_PRIVATE_KEY is malformed', async () => {
    process.env.OPERATOR_PRIVATE_KEY = '0xnotahexkey';
    process.env.ARC_ESCROW_ADDRESS = `0x${'a'.repeat(40)}`;
    const result = await submitCancelTrip({ onchainTripId: VALID_TRIP_ID });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('operator_key_unavailable');
    }
  });

  test('accepts the ARC_OPERATOR_PRIVATE_KEY env alias', async () => {
    // Both env names are accepted so deploys can keep their existing
    // naming convention (smoke uses TREASURY_PRIVATE_KEY; some prod
    // configs use ARC_OPERATOR_PRIVATE_KEY). Since no escrow is set
    // we expect escrow_unconfigured, NOT operator_key_unavailable —
    // proves the alias resolution worked.
    process.env.ARC_OPERATOR_PRIVATE_KEY = `0x${'1'.repeat(64)}`;
    const result = await submitSweepUnspent({ onchainTripId: VALID_TRIP_ID });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('escrow_unconfigured');
    }
  });

  test('returns escrow_unconfigured when no escrow address resolves', async () => {
    process.env.OPERATOR_PRIVATE_KEY = `0x${'1'.repeat(64)}`;
    const result = await submitSetClaimCodeHash({
      onchainTripId: VALID_TRIP_ID,
      newCodeHash: VALID_CODE_HASH,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('escrow_unconfigured');
    }
  });

});

// Real on-chain behavior (success paths, contract reverts decoded with
// errorName) is exercised by the Foundry suite at `contracts/test/` +
// the smoke harness at `scripts/smoke-guest-escrow.ts`. Mocking viem
// well enough to exercise simulate/writeContract paths in unit tests
// is more brittle than valuable; the env-validation contract above is
// what route handlers actually depend on.
