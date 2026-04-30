/**
 * Pure functions for weighted multisig math.
 *
 * Ported from desk-v1 (Fantasmita LLC, internal reuse for Sendero).
 * Zero dependencies. Fully testable.
 */

/** A signer in the weight system */
export interface SignerEntry {
  /** Unique key: -1 for current user, 0+ for invite row index */
  id: number;
  /** Team role */
  role: 'owner' | 'admin' | 'member' | 'device';
}

/** Current weight state — maps signer id → raw weight (0–1000) */
export type SignerWeightState = Record<number, number>;

/** Configuration for the weight system */
export interface WeightConfig {
  /** Total weight pool (default 1000) */
  maxWeight?: number;
  /** Majority fraction required (default 0.51 = 51%) */
  majorityFraction?: number;
  /** Minimum step for slider (default 50) */
  step?: number;
}

const DEFAULTS: Required<WeightConfig> = {
  maxWeight: 1000,
  majorityFraction: 0.51,
  step: 50,
};

/**
 * Rebalance signer weights.
 *
 * - No override: equal split among all signers.
 * - With override: set one signer's weight, distribute remainder equally.
 *
 * Returns a new state object (never mutates input).
 */
export function rebalanceWeights(
  signers: SignerEntry[],
  _prev: SignerWeightState,
  override?: { id: number; weight: number },
  config?: WeightConfig
): SignerWeightState {
  const { maxWeight } = { ...DEFAULTS, ...config };
  const signerIds = signers.filter(s => s.role !== 'member').map(s => s.id);

  if (signerIds.length === 0) return {};

  const next: SignerWeightState = {};

  if (override !== undefined) {
    const clamped = Math.max(0, Math.min(maxWeight, override.weight));
    next[override.id] = clamped;

    const remaining = maxWeight - clamped;
    const others = signerIds.filter(id => id !== override.id);
    const each = others.length > 0 ? Math.floor(remaining / others.length) : 0;
    for (const id of others) {
      next[id] = each;
    }
  } else {
    const each = Math.floor(maxWeight / signerIds.length);
    for (const id of signerIds) {
      next[id] = each;
    }
  }

  return next;
}

/** Compute the approval threshold from total signer weight. */
export function computeThreshold(
  weights: SignerWeightState,
  config?: WeightConfig
): { threshold: number; thresholdPct: number; totalWeight: number; signerCount: number } {
  const { majorityFraction } = { ...DEFAULTS, ...config };

  const values = Object.values(weights);
  const totalWeight = values.reduce((sum, w) => sum + w, 0);
  const signerCount = values.length;
  const threshold = totalWeight > 0 ? Math.floor(totalWeight * majorityFraction) : 0;
  const thresholdPct = totalWeight > 0 ? Math.round((threshold / totalWeight) * 100) : 0;

  return { threshold, thresholdPct, totalWeight, signerCount };
}

/** Convert raw weight (0–1000) to display percentage (0–100) */
export function weightToPct(weight: number, maxWeight = 1000): number {
  return Math.round((weight / maxWeight) * 100);
}

/** Convert display percentage (0–100) to raw weight (0–1000) */
export function pctToWeight(pct: number, maxWeight = 1000): number {
  return Math.round((pct / 100) * maxWeight);
}
