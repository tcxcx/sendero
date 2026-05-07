/**
 * Phase 5.x — Solana feedback ingestion helper.
 *
 * Mirrors the Arc-side `apps/app/app/api/webhooks/circle/events/handlers/reputation.ts`
 * shape for Solana Agent Registry feedback events. Once the
 * @metaplex-foundation/mpl-agent-identity SDK pins (Phase 4.x.y),
 * the indexer / webhook can ingest events via this helper without
 * re-deriving the upsert + aggregate logic.
 *
 * Conservation: the same `ReputationFeedback` table holds rows from
 * BOTH chains. Subject FK is to `OnchainIdentity.id` — that row's
 * `chain` field discriminates per-source. The mirrored reader
 * (`loadMirroredReputation`) folds across chains; this writer
 * deliberately writes one row at a time without touching Arc data.
 *
 * Idempotency:
 *   - txHash UNIQUE on ReputationFeedback already deduplicates by
 *     Solana signature when the indexer re-fires the same slot.
 *   - cached* counters re-aggregate from the full set after each
 *     write — same approach as Arc, robust to out-of-order events.
 */

import { prisma } from '@sendero/database';

export interface SolanaFeedbackEvent {
  /** Subject's Solana-side OnchainIdentity row id (chain='sol'). */
  subjectIdentityId: string;
  /** Optional rater's identity id when known on-platform. Null for off-platform raters. */
  fromIdentityId?: string | null;
  /** Rater's Solana pubkey (base58). */
  fromAddress: string;
  /** 0–100 score, mirrors Arc int128. */
  score: number;
  /** Optional human tag (max ~40 chars). */
  tag?: string | null;
  /** keccak/blake3 hash of the off-chain feedback payload — caller's choice, just must be deterministic per event. */
  feedbackHash: string;
  /** Optional URI to the off-chain feedback document. */
  uri?: string | null;
  /** Solana tx signature (base58). UNIQUE on ReputationFeedback.txHash. */
  signature: string;
  /** Slot number — stored in `blockNumber` (BigInt) since Solana has no concept of "block number" but slot maps cleanly. */
  slot: bigint;
  /** Optional Sendero domain refs for back-relation. */
  tripId?: string | null;
  bookingId?: string | null;
}

export interface IngestResult {
  status: 'inserted' | 'duplicate' | 'skipped';
  feedbackId?: string;
  reason?: string;
}

/**
 * Insert one ReputationFeedback row + recompute the subject's
 * cached* aggregates. Same upsert/recompute shape as the Arc handler.
 *
 * Returns `'duplicate'` when txHash collides (re-ingestion of an
 * already-indexed signature). Returns `'skipped'` when the subject
 * row doesn't exist or isn't on Sol — defensive against caller bugs.
 */
export async function recordSolanaFeedback(event: SolanaFeedbackEvent): Promise<IngestResult> {
  const subject = await prisma.onchainIdentity.findUnique({
    where: { id: event.subjectIdentityId },
    select: { id: true, chain: true },
  });
  if (!subject) {
    return { status: 'skipped', reason: 'subject_not_found' };
  }
  if (subject.chain !== 'sol') {
    return {
      status: 'skipped',
      reason: `subject_wrong_chain_${subject.chain}_expected_sol`,
    };
  }

  if (event.score < 0 || event.score > 100) {
    return { status: 'skipped', reason: `score_out_of_range_${event.score}` };
  }

  const stars = event.score / 20;

  try {
    const row = await prisma.reputationFeedback.create({
      data: {
        subjectId: subject.id,
        fromIdentityId: event.fromIdentityId ?? null,
        fromAddress: event.fromAddress,
        score: event.score,
        stars,
        tag: event.tag ?? null,
        feedbackHash: event.feedbackHash,
        uri: event.uri ?? null,
        txHash: event.signature,
        blockNumber: event.slot,
        tripId: event.tripId ?? null,
        bookingId: event.bookingId ?? null,
      },
    });

    // Re-aggregate cached* on the subject. Same approach Arc uses —
    // simpler to reason about than incremental updates under
    // out-of-order delivery.
    await refreshCachedAggregates(subject.id);

    return { status: 'inserted', feedbackId: row.id };
  } catch (err) {
    // P2002 = unique constraint (txHash). Duplicate ingest is a
    // success-equivalent: indexer fired twice for the same slot.
    if (err && typeof err === 'object' && 'code' in err && err.code === 'P2002') {
      return { status: 'duplicate' };
    }
    throw err;
  }
}

/**
 * Recompute and persist the subject's cached* aggregates. Exposed so
 * the indexer can call it after a batch insert without re-doing it
 * per-row.
 */
export async function refreshCachedAggregates(subjectIdentityId: string): Promise<void> {
  const rows = await prisma.reputationFeedback.findMany({
    where: { subjectId: subjectIdentityId },
    select: { score: true, fromAddress: true },
  });
  const validations = await prisma.validationCheck.findMany({
    where: { subjectId: subjectIdentityId },
    select: { validatorAddress: true, responseScore: true },
  });

  const count = rows.length;
  const avgScore =
    count > 0 ? rows.reduce((sum, r) => sum + r.score, 0) / count : null;
  const stars = avgScore !== null ? avgScore / 20 : null;
  const validators = new Set(rows.map(r => r.fromAddress.toLowerCase()));
  const validatorCount = validators.size;
  const validationCount = validations.length;

  await prisma.onchainIdentity.update({
    where: { id: subjectIdentityId },
    data: {
      cachedStars: stars,
      cachedFeedbackCount: count,
      cachedValidatorCount: validatorCount,
      cachedValidationCount: validationCount,
      cachedAt: new Date(),
    },
  });
}
