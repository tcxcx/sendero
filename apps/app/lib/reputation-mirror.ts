/**
 * Phase 5 — cross-chain reputation mirror.
 *
 * A Sendero subject (tenant or traveler) can hold one OnchainIdentity
 * per chain. Each chain runs its own indexer:
 *   - Arc: Circle Event Monitor → /api/webhooks/circle/events →
 *          ReputationFeedback rows + cached* counters on
 *          OnchainIdentity.
 *   - Solana: Phase 5.x will land an Agent Registry indexer (cron +
 *          /api/webhooks/solana-events). It writes ReputationFeedback
 *          rows joined to the Solana-side OnchainIdentity (chain=sol)
 *          and refreshes the same cached* counters.
 *
 * This module is the READ side. Given a subject (kind + tenantId or
 * userId), it loads ALL OnchainIdentity rows for that subject across
 * chains and folds them into a single view. The same `subjectId` keys
 * BOTH chains' ReputationFeedback rows because the FK is to
 * OnchainIdentity.id, not to the chain — but each row carries its own
 * chain via `subject.chain`, so callers can drill in per-chain when
 * they need to.
 *
 * Aggregation rules:
 *   - feedbackCount, validatorCount, validationCount → sum across chains
 *   - stars                                          → weighted average
 *     by feedbackCount; if feedbackCount=0 on every chain, returns null
 *   - cachedAt                                       → min(cachedAt)
 *     across rows that have a cached snapshot (the "freshness floor"
 *     — shows how stale the LEAST-fresh chain is, the more honest UX
 *     than max which would over-promise freshness)
 *   - mintedAt                                       → min(mintedAt)
 *     where present (when did this subject FIRST get an identity?)
 *
 * The mirror is deliberately read-only. Writes still go to the
 * canonical per-chain indexer; this module just stitches the
 * already-persisted rows. Phase 5.x adds the Solana indexer; v1
 * works correctly today because the only chain producing rows is Arc
 * — the aggregator collapses to "single chain" cleanly.
 */

import { prisma } from '@sendero/database';
import type { ChainKind } from '@sendero/database';

export interface MirroredReputationView {
  /** All chains the subject has an identity on. Empty when no identity exists. */
  chains: ChainKind[];
  /** Stars (0–5), weighted average across chains. Null when no feedback exists anywhere. */
  stars: number | null;
  /** Sum of cachedFeedbackCount across chains. */
  feedbackCount: number;
  /** Sum of cachedValidatorCount across chains. */
  validatorCount: number;
  /** Sum of cachedValidationCount across chains. */
  validationCount: number;
  /** Earliest `cachedAt` — i.e. when did the staler chain last refresh. */
  cachedAt: Date | null;
  /** Earliest `mintedAt` — when did the subject FIRST exist on-chain. */
  firstMintedAt: Date | null;
  /** Per-chain breakdown for callers that want to drill in. */
  perChain: Record<
    ChainKind,
    {
      identityId: string;
      contract: string;
      holderAddress: string;
      agentId: string | null;
      stars: number | null;
      feedbackCount: number;
      validatorCount: number;
      validationCount: number;
      cachedAt: Date | null;
      mintedAt: Date | null;
      status: string;
    } | null
  >;
}

export interface MirroredReputationInput {
  kind: 'org' | 'user';
  /** tenantId for `kind='org'`, userId for `kind='user'`. */
  subjectId: string;
}

/**
 * Pure aggregator — exported for unit tests + future Solana indexer
 * reuse. Caller passes the per-chain rows; this folds them into the
 * mirrored view.
 */
export function aggregateMirroredReputation(
  rows: Array<{
    chain: ChainKind;
    identityId: string;
    contract: string;
    holderAddress: string;
    agentId: string | null;
    cachedStars: number | null;
    cachedFeedbackCount: number;
    cachedValidatorCount: number;
    cachedValidationCount: number;
    cachedAt: Date | null;
    mintedAt: Date | null;
    status: string;
  }>
): MirroredReputationView {
  const perChain: MirroredReputationView['perChain'] = { arc: null, sol: null };
  let feedbackCount = 0;
  let validatorCount = 0;
  let validationCount = 0;
  // Weighted star sum: Σ (stars_i × count_i) / Σ count_i.
  let starsNumerator = 0;
  let starsDenominator = 0;
  let cachedAt: Date | null = null;
  let firstMintedAt: Date | null = null;
  const chains: ChainKind[] = [];

  for (const r of rows) {
    chains.push(r.chain);
    perChain[r.chain] = {
      identityId: r.identityId,
      contract: r.contract,
      holderAddress: r.holderAddress,
      agentId: r.agentId,
      stars: r.cachedStars,
      feedbackCount: r.cachedFeedbackCount,
      validatorCount: r.cachedValidatorCount,
      validationCount: r.cachedValidationCount,
      cachedAt: r.cachedAt,
      mintedAt: r.mintedAt,
      status: r.status,
    };
    feedbackCount += r.cachedFeedbackCount;
    validatorCount += r.cachedValidatorCount;
    validationCount += r.cachedValidationCount;
    if (r.cachedStars !== null && r.cachedFeedbackCount > 0) {
      starsNumerator += r.cachedStars * r.cachedFeedbackCount;
      starsDenominator += r.cachedFeedbackCount;
    }
    if (r.cachedAt && (cachedAt === null || r.cachedAt < cachedAt)) {
      cachedAt = r.cachedAt;
    }
    if (r.mintedAt && (firstMintedAt === null || r.mintedAt < firstMintedAt)) {
      firstMintedAt = r.mintedAt;
    }
  }

  const stars = starsDenominator > 0 ? starsNumerator / starsDenominator : null;

  return {
    chains,
    stars,
    feedbackCount,
    validatorCount,
    validationCount,
    cachedAt,
    firstMintedAt,
    perChain,
  };
}

/**
 * Server loader — reads OnchainIdentity rows for `(kind, subjectId)`
 * across both chains and aggregates. Returns `null` when the subject
 * has no identity on any chain (callers render the "no identity yet"
 * state).
 */
export async function loadMirroredReputation(
  args: MirroredReputationInput
): Promise<MirroredReputationView | null> {
  const where =
    args.kind === 'org'
      ? { kind: 'org', tenantId: args.subjectId }
      : { kind: 'user', userId: args.subjectId };

  const rows = await prisma.onchainIdentity.findMany({
    where,
    select: {
      id: true,
      chain: true,
      contract: true,
      holderAddress: true,
      agentId: true,
      cachedStars: true,
      cachedFeedbackCount: true,
      cachedValidatorCount: true,
      cachedValidationCount: true,
      cachedAt: true,
      mintedAt: true,
      status: true,
    },
  });
  if (rows.length === 0) return null;

  return aggregateMirroredReputation(
    rows.map(r => ({
      chain: r.chain,
      identityId: r.id,
      contract: r.contract,
      holderAddress: r.holderAddress,
      agentId: r.agentId,
      cachedStars: r.cachedStars,
      cachedFeedbackCount: r.cachedFeedbackCount,
      cachedValidatorCount: r.cachedValidatorCount,
      cachedValidationCount: r.cachedValidationCount,
      cachedAt: r.cachedAt,
      mintedAt: r.mintedAt,
      status: r.status,
    }))
  );
}
