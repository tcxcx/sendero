/**
 * `give_feedback` — record a 1-5 star rating for a counterparty's
 * ERC-8004 agent NFT. Used by both sides of a Sendero trip:
 *
 *   - Agency (org-DCW signer) rates the user (user agentId)
 *   - User (user-DCW signer) rates the agency (org agentId)
 *
 * Cross-rating per ERC-8004's no-self-rating rule: the rater's wallet
 * owns a *different* agent NFT than the subject. We resolve the rater's
 * `OnchainIdentity` from the call context and assert
 * `rater.agentId !== subject.agentId` before any on-chain call — failing
 * fast is cheaper than a reverted tx + meter event.
 *
 * Score mapping (locked): `score = stars × 20`, so 1★=20, 5★=100. The
 * on-chain field is int128; we stay in the 0-100 range to match the
 * existing aggregation logic in `getReputation`.
 *
 * Privileged tool (requires HMAC-signed request) because it moves
 * trust state on-chain. Sandbox keys can call it; production keys
 * need explicit `give_feedback` scope (see `scopes.ts`).
 */

import { z } from 'zod';

import { giveFeedback } from '@sendero/arc/identity';
import { prisma } from '@sendero/database';

import { resolveWalletUuidByAddress } from './resolve-wallet';
import type { ToolDef } from './types';

const inputSchema = z.object({
  /** Subject of the rating — the on-chain ERC-8004 agent id of the rated party. */
  subjectAgentId: z.string().regex(/^\d+$/, 'subjectAgentId must be a decimal uint256 string'),
  /** 1-5 stars. Mapped to int128 0-100 score via score = stars × 20. */
  stars: z.number().int().min(1).max(5),
  /** Short label describing the feedback context (on_time, clean_pnr, dispute_resolved, …). */
  tag: z.string().min(1).max(64),
  /** Who is doing the rating — drives validator wallet resolution + self-rating guard. */
  fromKind: z.enum(['org', 'user']),
  fromTenantId: z.string().optional(),
  fromUserId: z.string().optional(),
  /** Audit trail: trip / booking that drove this rating. */
  tripId: z.string().optional(),
  bookingId: z.string().optional(),
  /** Optional evidence URI (IPFS, signed-receipt URL, …). */
  evidenceUri: z.string().optional(),
});

type Input = z.infer<typeof inputSchema>;

interface GiveFeedbackResult {
  ok: true;
  txHash: string;
  txId: string;
  subjectAgentId: string;
  raterAgentId: string;
  stars: number;
  score: number;
  tag: string;
}

export const giveFeedbackTool: ToolDef<Input, GiveFeedbackResult> = {
  name: 'give_feedback',
  description:
    "Record a 1-5 star rating for a counterparty on the ERC-8004 ReputationRegistry on Arc. Cross-rating: the rater's own DCW signs (not Sendero treasury), so the on-chain trust graph is a true peer graph. Self-rating is rejected. Score mapping: stars × 20.",
  internal: false,
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['subjectAgentId', 'stars', 'tag', 'fromKind'],
    properties: {
      subjectAgentId: { type: 'string', pattern: '^\\d+$' },
      stars: { type: 'integer', minimum: 1, maximum: 5 },
      tag: { type: 'string', minLength: 1, maxLength: 64 },
      fromKind: { type: 'string', enum: ['org', 'user'] },
      fromTenantId: { type: 'string' },
      fromUserId: { type: 'string' },
      tripId: { type: 'string' },
      bookingId: { type: 'string' },
      evidenceUri: { type: 'string' },
    },
  },
  async handler(input) {
    if (input.fromKind === 'org' && !input.fromTenantId) {
      throw new Error('fromTenantId required when fromKind=org');
    }
    if (input.fromKind === 'user' && !input.fromUserId) {
      throw new Error('fromUserId required when fromKind=user');
    }

    // Resolve the rater's OnchainIdentity → holder address.
    const rater = await prisma.onchainIdentity.findFirst({
      where:
        input.fromKind === 'org'
          ? { kind: 'org', tenantId: input.fromTenantId }
          : { kind: 'user', userId: input.fromUserId },
      select: { id: true, agentId: true, holderAddress: true, status: true },
    });
    if (!rater || !rater.agentId) {
      throw new Error(
        `No minted OnchainIdentity for ${input.fromKind} ${
          input.fromTenantId ?? input.fromUserId
        } — provision the wallet + identity first.`
      );
    }
    if (rater.status !== 'minted') {
      throw new Error(
        `OnchainIdentity ${rater.id} is status=${rater.status} — wait for the sweeper to confirm the mint.`
      );
    }

    // Self-rating guard. ERC-8004 enforces this on-chain too, but the
    // revert costs ~$0.005 of meter time + a confused log line.
    if (rater.agentId === input.subjectAgentId) {
      throw new Error(
        `Self-rating not allowed: rater agent ${rater.agentId} == subject agent ${input.subjectAgentId}`
      );
    }

    // Circle DCW signs by walletId UUID, not on-chain address. Resolve the
    // rater's holder address back to its Circle wallet UUID before signing.
    const raterWalletUuid = await resolveWalletUuidByAddress(rater.holderAddress);
    if (!raterWalletUuid) {
      throw new Error(
        `No Circle wallet UUID for rater ${input.fromKind} holder ${rater.holderAddress} — provision the wallet first.`
      );
    }

    const score = input.stars * 20;
    const result = await giveFeedback({
      validatorWalletAddress: raterWalletUuid,
      agentId: BigInt(input.subjectAgentId),
      score,
      tag: input.tag,
    });

    // The Circle Event Monitor webhook will insert the canonical
    // ReputationFeedback row when FeedbackGiven fires. We DO NOT
    // double-write here — that would race the webhook + violate the
    // txHash UNIQUE. The on-chain txHash + event are the source of
    // truth; Postgres reflects them.

    return {
      ok: true,
      txHash: result.txHash,
      txId: result.txId,
      subjectAgentId: input.subjectAgentId,
      raterAgentId: rater.agentId,
      stars: input.stars,
      score,
      tag: input.tag,
    };
  },
};
