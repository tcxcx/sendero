/**
 * Phase 5 — pure-aggregation unit tests.
 *
 * No DB. Synthesizes per-chain rows + asserts the fold. Covers the
 * three shapes the loader will encounter:
 *   1. Single-chain (Arc only — today's reality).
 *   2. Dual-chain with feedback on both.
 *   3. Dual-chain with feedback on only one (other chain is fresh
 *      identity, no events yet).
 */

import { describe, expect, test } from 'bun:test';

import { aggregateMirroredReputation } from './reputation-mirror';

describe('aggregateMirroredReputation', () => {
  test('single-chain Arc — passes through cleanly', () => {
    const out = aggregateMirroredReputation([
      {
        chain: 'arc',
        identityId: 'oid_arc_1',
        contract: '0x8004A8',
        holderAddress: '0xabc',
        agentId: '42',
        cachedStars: 4.5,
        cachedFeedbackCount: 10,
        cachedValidatorCount: 3,
        cachedValidationCount: 5,
        cachedAt: new Date('2026-05-01T00:00:00Z'),
        mintedAt: new Date('2026-04-01T00:00:00Z'),
        status: 'minted',
      },
    ]);
    expect(out.chains).toEqual(['arc']);
    expect(out.stars).toBe(4.5);
    expect(out.feedbackCount).toBe(10);
    expect(out.validatorCount).toBe(3);
    expect(out.validationCount).toBe(5);
    expect(out.perChain.arc?.identityId).toBe('oid_arc_1');
    expect(out.perChain.sol).toBeNull();
  });

  test('dual-chain with feedback on both — weighted average', () => {
    const out = aggregateMirroredReputation([
      {
        chain: 'arc',
        identityId: 'oid_arc',
        contract: '0x8004A8',
        holderAddress: '0xabc',
        agentId: '42',
        cachedStars: 4.0, // 80 feedback
        cachedFeedbackCount: 80,
        cachedValidatorCount: 5,
        cachedValidationCount: 10,
        cachedAt: new Date('2026-05-01T00:00:00Z'),
        mintedAt: new Date('2026-04-01T00:00:00Z'),
        status: 'minted',
      },
      {
        chain: 'sol',
        identityId: 'oid_sol',
        contract: '1DREGFgysWYxLnRnKQnwrxnJQeSMk2HmGaC6whw2B2p',
        holderAddress: 'SoL...vault',
        agentId: null,
        cachedStars: 5.0, // 20 feedback
        cachedFeedbackCount: 20,
        cachedValidatorCount: 2,
        cachedValidationCount: 3,
        cachedAt: new Date('2026-05-02T00:00:00Z'),
        mintedAt: new Date('2026-04-15T00:00:00Z'),
        status: 'minted',
      },
    ]);
    // Weighted: (4.0 × 80 + 5.0 × 20) / (80 + 20) = (320 + 100) / 100 = 4.2
    expect(out.stars).toBe(4.2);
    expect(out.feedbackCount).toBe(100);
    expect(out.validatorCount).toBe(7);
    expect(out.validationCount).toBe(13);
    // cachedAt is the EARLIER (less fresh) — 2026-05-01.
    expect(out.cachedAt?.toISOString()).toBe('2026-05-01T00:00:00.000Z');
    // firstMintedAt is the EARLIEST — 2026-04-01.
    expect(out.firstMintedAt?.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect(out.chains.sort()).toEqual(['arc', 'sol']);
  });

  test('dual-chain but Solana is fresh (no feedback yet) — Arc stars hold', () => {
    const out = aggregateMirroredReputation([
      {
        chain: 'arc',
        identityId: 'oid_arc',
        contract: '0x8004A8',
        holderAddress: '0xabc',
        agentId: '42',
        cachedStars: 4.5,
        cachedFeedbackCount: 10,
        cachedValidatorCount: 3,
        cachedValidationCount: 5,
        cachedAt: new Date('2026-05-01T00:00:00Z'),
        mintedAt: new Date('2026-04-01T00:00:00Z'),
        status: 'minted',
      },
      {
        chain: 'sol',
        identityId: 'oid_sol',
        contract: '1DREGFgysWYxLnRnKQnwrxnJQeSMk2HmGaC6whw2B2p',
        holderAddress: 'SoL...vault',
        agentId: null,
        cachedStars: null,
        cachedFeedbackCount: 0,
        cachedValidatorCount: 0,
        cachedValidationCount: 0,
        cachedAt: null,
        mintedAt: new Date('2026-05-06T00:00:00Z'),
        status: 'minted',
      },
    ]);
    expect(out.stars).toBe(4.5);
    expect(out.feedbackCount).toBe(10);
    // cachedAt picks Arc's value because Sol's is null.
    expect(out.cachedAt?.toISOString()).toBe('2026-05-01T00:00:00.000Z');
  });

  test('no feedback anywhere — stars is null, not 0', () => {
    const out = aggregateMirroredReputation([
      {
        chain: 'arc',
        identityId: 'oid_arc',
        contract: '0x8004A8',
        holderAddress: '0xabc',
        agentId: null,
        cachedStars: null,
        cachedFeedbackCount: 0,
        cachedValidatorCount: 0,
        cachedValidationCount: 0,
        cachedAt: null,
        mintedAt: new Date('2026-04-01T00:00:00Z'),
        status: 'minted',
      },
    ]);
    expect(out.stars).toBeNull();
    expect(out.feedbackCount).toBe(0);
  });

  test('empty input → empty view', () => {
    const out = aggregateMirroredReputation([]);
    expect(out.chains).toEqual([]);
    expect(out.stars).toBeNull();
    expect(out.feedbackCount).toBe(0);
    expect(out.cachedAt).toBeNull();
    expect(out.firstMintedAt).toBeNull();
    expect(out.perChain.arc).toBeNull();
    expect(out.perChain.sol).toBeNull();
  });
});
