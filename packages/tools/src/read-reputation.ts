/**
 * `read_reputation` — return aggregated reputation for an org / user / agentId.
 *
 * Cache-first: reads from `OnchainIdentity.cached*` columns (sub-50ms,
 * written by the Circle Event Monitor webhook on every FeedbackGiven
 * event). Falls back to direct chain RPC via `getReputation` from
 * `@sendero/arc/identity` for external counterparties not in our index.
 *
 * Public scope — any agent can read any subject's reputation. The
 * shareability is the point: a counterparty agency in a different
 * Sendero tenant must be able to inspect a user's track record before
 * engaging.
 *
 * Returns the most-recent N feedback events too so the caller can
 * surface "recent reviews" inline. Stars 1-5 derived from on-chain
 * score (score / 20).
 */

import { getReputation } from '@sendero/arc/identity';
import { prisma } from '@sendero/database';
import { z } from 'zod';

import type { ToolDef } from './types';

const inputSchema = z
  .object({
    /** Sendero subject — exactly one of these is required. */
    tenantId: z.string().optional(),
    userId: z.string().optional(),
    /** On-chain agent NFT id (decimal uint256) — used for cross-platform lookups. */
    agentId: z.string().regex(/^\d+$/).optional(),
    /** How many recent feedback rows to include in the response. */
    recentLimit: z.number().int().min(0).max(50).default(10),
  })
  .refine(v => v.tenantId || v.userId || v.agentId, {
    message: 'one of tenantId, userId, agentId is required',
  });

type Input = z.infer<typeof inputSchema>;

interface ReputationReadResult {
  agentId: string | null;
  kind: 'org' | 'user' | 'external';
  holderAddress: string | null;
  /** Star average 0-5, null when no feedback. */
  stars: number | null;
  /** Total feedback events, including duplicates from the same validator. */
  feedbackCount: number;
  /** Distinct validator addresses — diversity indicator. */
  validatorCount: number;
  /** Successful KYC/KYB validations against the subject. */
  validationCount: number;
  source: 'cache' | 'chain' | 'empty';
  cachedAt: string | null;
  recent: Array<{
    stars: number;
    score: number;
    tag: string | null;
    fromAddress: string;
    txHash: string;
    createdAt: string;
  }>;
}

export const readReputationTool: ToolDef<Input, ReputationReadResult> = {
  name: 'read_reputation',
  description:
    'Read aggregated ERC-8004 reputation for a Sendero org, user, or any on-chain agent NFT. Cache-first (~50ms) with chain RPC fallback for external agents. Returns mean stars 0-5, feedback count, validator count, validation count, and the most-recent feedback rows.',
  internal: false,
  inputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      tenantId: { type: 'string' },
      userId: { type: 'string' },
      agentId: { type: 'string', pattern: '^\\d+$' },
      recentLimit: { type: 'integer', minimum: 0, maximum: 50, default: 10 },
    },
  },
  async handler(input) {
    // Resolve the OnchainIdentity row by whichever lookup the caller
    // supplied. Any of (tenantId, userId, agentId) lands the same row
    // because all three are UNIQUE.
    const identity = await prisma.onchainIdentity.findFirst({
      where: input.tenantId
        ? { kind: 'org', tenantId: input.tenantId }
        : input.userId
          ? { kind: 'user', userId: input.userId }
          : { agentId: input.agentId },
      select: {
        agentId: true,
        kind: true,
        holderAddress: true,
        cachedStars: true,
        cachedFeedbackCount: true,
        cachedValidatorCount: true,
        cachedValidationCount: true,
        cachedAt: true,
      },
    });

    // Cache hit path — fast.
    if (identity && identity.agentId && identity.cachedAt) {
      const recent = await prisma.reputationFeedback.findMany({
        where: { subject: { agentId: identity.agentId } },
        orderBy: { createdAt: 'desc' },
        take: input.recentLimit,
        select: {
          stars: true,
          score: true,
          tag: true,
          fromAddress: true,
          txHash: true,
          createdAt: true,
        },
      });
      return {
        agentId: identity.agentId,
        kind: identity.kind as 'org' | 'user',
        holderAddress: identity.holderAddress,
        stars: identity.cachedStars,
        feedbackCount: identity.cachedFeedbackCount,
        validatorCount: identity.cachedValidatorCount,
        validationCount: identity.cachedValidationCount,
        source: 'cache',
        cachedAt: identity.cachedAt.toISOString(),
        recent: recent.map(r => ({
          stars: r.stars,
          score: r.score,
          tag: r.tag,
          fromAddress: r.fromAddress,
          txHash: r.txHash,
          createdAt: r.createdAt.toISOString(),
        })),
      };
    }

    // Identity row exists but no cached aggregation yet (no events
    // observed) — return zero counts.
    if (identity && identity.agentId) {
      return {
        agentId: identity.agentId,
        kind: identity.kind as 'org' | 'user',
        holderAddress: identity.holderAddress,
        stars: null,
        feedbackCount: 0,
        validatorCount: 0,
        validationCount: 0,
        source: 'empty',
        cachedAt: null,
        recent: [],
      };
    }

    // Fallback: external agentId not in our index (cross-tenant lookup
    // for a counterparty). Hit chain RPC directly via @sendero/arc.
    if (input.agentId) {
      try {
        const summary = await getReputation(BigInt(input.agentId));
        return {
          agentId: input.agentId,
          kind: 'external',
          holderAddress: null,
          stars: summary.stars,
          feedbackCount: summary.count,
          validatorCount: summary.validators,
          validationCount: 0,
          source: 'chain',
          cachedAt: new Date(summary.updatedAt).toISOString(),
          recent: [],
        };
      } catch (err) {
        // Chain read failed — return empty rather than throw. Callers
        // typically use this read to gate engagement; an unknown
        // agent should be {ok:'unknown'}, not 500.
        console.warn('[read-reputation] chain RPC fallback failed for agentId', input.agentId, err);
      }
    }

    return {
      agentId: input.agentId ?? null,
      kind: 'external',
      holderAddress: null,
      stars: null,
      feedbackCount: 0,
      validatorCount: 0,
      validationCount: 0,
      source: 'empty',
      cachedAt: null,
      recent: [],
    };
  },
};
