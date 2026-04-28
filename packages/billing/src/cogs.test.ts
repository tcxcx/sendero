/**
 * Unit tests for the per-model COGS registry.
 *
 * Covers:
 *   - cogsPerTurnMicro returns 0n for unknown models (graceful, doesn't lock everything)
 *   - isModelAllowedByCap honors null cap (Enterprise = unbounded)
 *   - allowedModelsForCap filters correctly across the 6 registered models
 *   - defaultModelForCap returns the cheapest allowed model
 *   - Provider constraint enforced: only anthropic | openai | google
 *   - Each model has the COGS value it should — guard rail against accidental
 *     edits to `CHAT_MODEL_COGS` that would silently invert the tier ladder
 */

import { describe, expect, test } from 'bun:test';

import {
  CHAT_MODEL_COGS,
  allowedModelsForCap,
  cogsForModel,
  cogsPerTurnMicro,
  defaultModelForCap,
  isModelAllowedByCap,
} from './cogs';

describe('cogsForModel', () => {
  test('returns the registered entry for a known model', () => {
    const sonnet = cogsForModel('anthropic/claude-sonnet-4-5');
    expect(sonnet).not.toBeNull();
    expect(sonnet?.provider).toBe('anthropic');
    expect(sonnet?.name).toBe('Claude Sonnet 4.5');
  });

  test('returns null for unknown models', () => {
    expect(cogsForModel('anthropic/claude-fake-model')).toBeNull();
    expect(cogsForModel('')).toBeNull();
    expect(cogsForModel('foo/bar')).toBeNull();
  });
});

describe('cogsPerTurnMicro', () => {
  test('returns the registered cost for known models', () => {
    expect(cogsPerTurnMicro('google/gemini-2.5-flash')).toBe(6_000n);
    expect(cogsPerTurnMicro('openai/gpt-5-mini')).toBe(5_000n);
    expect(cogsPerTurnMicro('anthropic/claude-opus-4-1')).toBe(203_000n);
  });

  test('returns 0n for unknown models so caps do not silently lock new releases', () => {
    expect(cogsPerTurnMicro('google/gemini-99-mega')).toBe(0n);
  });
});

describe('isModelAllowedByCap', () => {
  test('null cap allows every registered model (Enterprise)', () => {
    for (const m of CHAT_MODEL_COGS) {
      expect(isModelAllowedByCap(m.id, null)).toBe(true);
    }
  });

  test('rejects unknown models when a cap is set', () => {
    // Unknown models are NOT registered — `cogsForModel` returns null —
    // and `isModelAllowedByCap` returns false. This is the safe default
    // (admin must explicitly register a new model before customers can
    // pick it).
    expect(isModelAllowedByCap('unknown/model', 1_000_000n)).toBe(false);
  });

  test('Free/Basic-tier cap (7_000n) lets flash and gpt-5-mini through, blocks gpt-5+', () => {
    expect(isModelAllowedByCap('google/gemini-2.5-flash', 7_000n)).toBe(true);
    expect(isModelAllowedByCap('openai/gpt-5-mini', 7_000n)).toBe(true);
    expect(isModelAllowedByCap('openai/gpt-5', 7_000n)).toBe(false);
    expect(isModelAllowedByCap('anthropic/claude-sonnet-4-5', 7_000n)).toBe(false);
    expect(isModelAllowedByCap('anthropic/claude-opus-4-1', 7_000n)).toBe(false);
  });

  test('Pro-tier cap (50_000n) lets sonnet through, still blocks opus', () => {
    expect(isModelAllowedByCap('openai/gpt-5', 50_000n)).toBe(true);
    expect(isModelAllowedByCap('google/gemini-2.5-pro', 50_000n)).toBe(true);
    expect(isModelAllowedByCap('anthropic/claude-sonnet-4-5', 50_000n)).toBe(true);
    expect(isModelAllowedByCap('anthropic/claude-opus-4-1', 50_000n)).toBe(false);
  });

  test('cap exactly at cogs is inclusive (allows the model)', () => {
    // Sonnet costs 41_000n. A cap of exactly 41_000n must allow it,
    // because the comparison is `<=` not `<`.
    expect(isModelAllowedByCap('anthropic/claude-sonnet-4-5', 41_000n)).toBe(true);
    expect(isModelAllowedByCap('anthropic/claude-sonnet-4-5', 40_999n)).toBe(false);
  });
});

describe('allowedModelsForCap', () => {
  test('null cap returns all registered models', () => {
    const ids = allowedModelsForCap(null);
    expect(ids).toEqual(CHAT_MODEL_COGS.map(m => m.id));
  });

  test('Free/Basic cap returns 2 models (flash + gpt-5-mini)', () => {
    const ids = allowedModelsForCap(7_000n);
    expect(ids).toContain('google/gemini-2.5-flash');
    expect(ids).toContain('openai/gpt-5-mini');
    expect(ids).not.toContain('openai/gpt-5');
    expect(ids).not.toContain('anthropic/claude-opus-4-1');
    expect(ids.length).toBe(2);
  });

  test('Pro cap returns 5 models (everything except opus)', () => {
    const ids = allowedModelsForCap(50_000n);
    expect(ids.length).toBe(5);
    expect(ids).not.toContain('anthropic/claude-opus-4-1');
  });

  test('zero cap returns no models (sandbox-only, free tier with no agent)', () => {
    expect(allowedModelsForCap(0n)).toEqual([]);
  });
});

describe('defaultModelForCap', () => {
  test('picks the cheapest allowed model under Pro cap', () => {
    // gpt-5-mini at 5_000n is cheaper than flash at 6_000n. The
    // function sorts at call time, so it returns mini regardless of
    // registry order.
    expect(defaultModelForCap(50_000n)).toBe('openai/gpt-5-mini');
  });

  test('falls back to flash when no models match (defensive)', () => {
    // 0n cap → no models registered would pass — function returns
    // the hardcoded flash fallback so dispatch never resolves to
    // nothing.
    expect(defaultModelForCap(0n)).toBe('google/gemini-2.5-flash');
  });

  test('returns the cheapest model for the unbounded (Enterprise) cap', () => {
    // Same answer as the Pro cap: cheapest registered is gpt-5-mini.
    expect(defaultModelForCap(null)).toBe('openai/gpt-5-mini');
  });
});

describe('CHAT_MODEL_COGS registry shape', () => {
  test('every entry has a valid provider', () => {
    const validProviders = new Set(['anthropic', 'openai', 'google']);
    for (const m of CHAT_MODEL_COGS) {
      expect(validProviders.has(m.provider)).toBe(true);
    }
  });

  test('every entry has a positive cogsPerTurnMicro', () => {
    for (const m of CHAT_MODEL_COGS) {
      expect(m.cogsPerTurnMicro).toBeGreaterThan(0n);
    }
  });

  test('every model id is unique', () => {
    const ids = CHAT_MODEL_COGS.map(m => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
