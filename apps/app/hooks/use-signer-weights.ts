'use client';

/**
 * React hook for managing weighted multisig signer configuration.
 *
 * Ported from desk-v1 (Fantasmita LLC, internal reuse for Sendero).
 * Source: `packages/wallets/src/multisig/use-signer-weights.ts`.
 *
 * Handles auto-rebalancing when signers change, manual weight overrides,
 * and threshold computation. Pure state management — no UI coupling.
 *
 * @example
 * ```tsx
 * const signers = [
 *   { id: -1, role: 'owner' },   // current user
 *   { id: 0, role: 'admin' },    // first invite
 *   { id: 1, role: 'member' },   // second invite (not a signer)
 * ];
 *
 * const { weights, threshold, thresholdPct, signerCount, getWeightPct, setWeight } =
 *   useSignerWeights(signers);
 * ```
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  computeThreshold,
  rebalanceWeights,
  type SignerEntry,
  type SignerWeightState,
  type WeightConfig,
  weightToPct,
} from '@sendero/multisig/weights';

export function useSignerWeights(signers: SignerEntry[], config?: WeightConfig) {
  const [weights, setWeights] = useState<SignerWeightState>(() =>
    rebalanceWeights(signers, {}, undefined, config)
  );

  // Rebalance when signers change (role changes, add/remove).
  const signerKey = signers
    .filter(s => s.role !== 'member')
    .map(s => `${s.id}:${s.role}`)
    .join(',');

  useEffect(() => {
    setWeights(prev => rebalanceWeights(signers, prev, undefined, config));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signerKey]);

  const setWeight = useCallback(
    (id: number, weight: number) => {
      setWeights(prev => rebalanceWeights(signers, prev, { id, weight }, config));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signerKey, config]
  );

  const { threshold, thresholdPct, totalWeight, signerCount } = useMemo(
    () => computeThreshold(weights, config),
    [weights, config]
  );

  const getWeight = useCallback((id: number) => weights[id] ?? 0, [weights]);
  const getWeightPct = useCallback(
    (id: number) => weightToPct(weights[id] ?? 0, config?.maxWeight),
    [weights, config?.maxWeight]
  );

  return {
    /** Raw weight map: signer id → weight (0–1000) */
    weights,
    /** Majority threshold (raw) */
    threshold,
    /** Majority threshold (percentage) */
    thresholdPct,
    /** Total weight across all signers */
    totalWeight,
    /** Number of active signers (excludes members) */
    signerCount,
    /** Get raw weight for a signer */
    getWeight,
    /** Get percentage (0–100) for a signer */
    getWeightPct,
    /** Set one signer's weight; others auto-rebalance */
    setWeight,
  };
}
