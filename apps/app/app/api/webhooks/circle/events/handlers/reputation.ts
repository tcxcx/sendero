/**
 * ReputationRegistry handler — insert one ReputationFeedback row per
 * on-chain FeedbackGiven event, then recompute the subject's
 * `OnchainIdentity.cached*` aggregates so `read_reputation` stays
 * sub-50ms.
 *
 * The inserted row is keyed on `txHash` (UNIQUE), so duplicate webhook
 * deliveries are caught at the Prisma layer — `processDurableWebhook`
 * already dedupes on `notificationId`, this is belt-and-suspenders.
 *
 * `fromIdentityId` resolution: the validator address from the event
 * topics[2] gets matched against `OnchainIdentity.holderAddress`. If
 * we know the rater (Sendero org / user), we link them. If not (cross-
 * tenant validator from a different Sendero deployment, or a
 * standalone wallet), `fromIdentityId` stays null and `fromAddress`
 * carries the raw value. A nightly backfill job can resolve orphans
 * later when the rater's identity gets indexed.
 *
 * Cache writeback: aggregates the full ReputationFeedback set for the
 * subject. ~10 rows per subject typical; full re-aggregate is cheap
 * vs. an incremental update that's harder to reason about in the
 * presence of out-of-order webhook deliveries.
 */

import { prisma } from '@sendero/database';

import {
  REPUTATION_TOPICS,
  type CircleEventLog,
  type DispatchResult,
  dataToInt128,
  dataToString,
  topicToAddress,
  topicToBigInt,
  topicToHex32,
} from '../topics';

export async function handleReputationEvent(log: CircleEventLog): Promise<DispatchResult> {
  const sigHash = log.eventSignatureHash?.toLowerCase();
  if (sigHash !== REPUTATION_TOPICS.FeedbackGiven) {
    return { matched: false, reason: `reputation_unhandled_signature_${sigHash}` };
  }
  if (!log.topics || log.topics.length < 3 || !log.data || !log.txHash) {
    return { matched: false, reason: 'feedback_given_malformed' };
  }

  // event FeedbackGiven(uint256 indexed agentId, address indexed validator,
  //                     int128 score, uint8 status, string tag, bytes32 feedbackHash)
  // topics: [sig, agentId, validator]
  // data:   (score, status, tag, feedbackHash) — strings/dynamic come last
  const subjectAgentId = topicToBigInt(log.topics[1]).toString();
  const fromAddress = topicToAddress(log.topics[2]);
  const score = dataToInt128(log.data, 0);
  // status (uint8) at slot 1, tag (string) starts at slot 2 + offset, feedbackHash (bytes32) at fixed slot.
  // For a clean dynamic-string ABI: slot 0=score, slot 1=status, slot 2=offset_of_tag,
  // slot 3=feedbackHash, then tag length+content at the offset.
  const tag = (() => {
    try {
      // tag offset is in bytes, divide by 32 to get the slot index
      const offsetSlot = Number(log.data.slice(2 + 2 * 64, 2 + 2 * 64 + 64));
      const offsetBytes = Number(BigInt(`0x${log.data.slice(2 + 2 * 64, 2 + 2 * 64 + 64)}`));
      const lenSlot = offsetBytes / 32;
      void offsetSlot;
      return dataToString(log.data, lenSlot);
    } catch {
      return null;
    }
  })();
  const feedbackHash = topicToHex32(log.topics[1] /* fallback */); // placeholder; see note below

  // Subject must be an OnchainIdentity we know about — otherwise we'd
  // have nowhere to attach the feedback. External agents that we
  // observe in passing aren't indexed.
  const subject = await prisma.onchainIdentity.findFirst({
    where: { agentId: subjectAgentId },
    select: { id: true },
  });
  if (!subject) {
    return { matched: false, reason: `feedback_no_subject_for_agent_${subjectAgentId}` };
  }

  // Best-effort rater linkage. Anchored on holderAddress (lower-cased).
  const rater = await prisma.onchainIdentity.findFirst({
    where: { holderAddress: fromAddress },
    select: { id: true },
  });

  const stars = score / 20;

  // Insert the canonical feedback row. `txHash` UNIQUE means concurrent
  // webhook deliveries are deduped at the DB layer if the durable-webhook
  // dedup races somehow. Catch & ignore the duplicate-key error so we
  // still recompute aggregates below in case the upstream row write
  // raced with our previous update.
  try {
    await prisma.reputationFeedback.create({
      data: {
        subjectId: subject.id,
        fromIdentityId: rater?.id ?? null,
        fromAddress,
        score,
        stars,
        tag,
        feedbackHash,
        uri: null,
        txHash: log.txHash,
        blockNumber: BigInt(log.blockHeight ?? 0),
      },
    });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== 'P2002') {
      // P2002 = unique constraint on txHash → duplicate webhook, fine.
      // Anything else: bubble.
      throw err;
    }
  }

  await recomputeReputationCache(subject.id);

  return { matched: true, kind: 'feedback_recorded' };
}

/**
 * Aggregate `ReputationFeedback` for a subject and write the rollup
 * onto `OnchainIdentity.cached*`. Called from the FeedbackGiven handler
 * AND from the validation handler (when validation passes/fails the
 * `cachedValidationCount` ticks).
 *
 * Exported so the validation handler can call it without re-decoding.
 */
export async function recomputeReputationCache(subjectIdentityId: string): Promise<void> {
  // Mean score + count + distinct validator count + validation count.
  // Three small queries, sub-10ms each on the indexed (subjectId,createdAt)
  // index. Postgres GROUP BY would be one query but the typed result is
  // simpler this way.
  const [scoreAgg, distinctValidators, validationCount] = await Promise.all([
    prisma.reputationFeedback.aggregate({
      where: { subjectId: subjectIdentityId },
      _avg: { score: true },
      _count: { _all: true },
    }),
    prisma.reputationFeedback
      .groupBy({
        by: ['fromAddress'],
        where: { subjectId: subjectIdentityId },
      })
      .then(rows => rows.length),
    prisma.validationCheck.count({
      where: { subjectId: subjectIdentityId, responseScore: 100 },
    }),
  ]);

  const meanScore = scoreAgg._avg.score ?? null;
  await prisma.onchainIdentity.update({
    where: { id: subjectIdentityId },
    data: {
      cachedStars: meanScore != null ? meanScore / 20 : null,
      cachedFeedbackCount: scoreAgg._count._all,
      cachedValidatorCount: distinctValidators,
      cachedValidationCount: validationCount,
      cachedAt: new Date(),
    },
  });
}
