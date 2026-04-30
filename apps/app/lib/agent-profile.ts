/**
 * Server-side loader for the public ERC-8004 agent profile pages.
 * Reads from `OnchainIdentity.cached*` (sub-50ms) and joins the most-
 * recent N feedback rows so the page renders in one round-trip.
 *
 * Used by:
 *   - apps/app/app/agents/[kind]/[id]/page.tsx (public profile)
 *   - apps/app/app/agents/[kind]/[id]/metadata.json/route.ts (already wired)
 *
 * Cached 5 min via unstable_cache because reputation aggregates only
 * change when a webhook fires; the cache invalidates on the
 * 'reputation' tag from the webhook handler if we ever wire it.
 */

import { unstable_cache } from 'next/cache';

import { prisma } from '@sendero/database';

export interface AgentProfile {
  kind: 'org' | 'user';
  subjectId: string;
  agentId: string | null;
  contract: string;
  holderAddress: string;
  status: 'pending' | 'minted' | 'failed';
  displayName: string;
  mintedAt: string | null;
  stars: number | null;
  feedbackCount: number;
  validatorCount: number;
  validationCount: number;
  cachedAt: string | null;
  recent: Array<{
    stars: number;
    score: number;
    tag: string | null;
    fromAddress: string;
    txHash: string;
    tripId: string | null;
    bookingId: string | null;
    createdAt: string;
  }>;
  validations: Array<{
    validatorAddress: string;
    requestHash: string;
    responseScore: number | null;
    tag: string | null;
    createdAt: string;
    resolvedAt: string | null;
  }>;
}

export async function loadAgentProfileFresh(args: {
  kind: 'org' | 'user';
  subjectId: string;
}): Promise<AgentProfile | null> {
  const identity = await prisma.onchainIdentity.findFirst({
    where:
      args.kind === 'org'
        ? { kind: 'org', tenantId: args.subjectId }
        : { kind: 'user', userId: args.subjectId },
    select: {
      id: true,
      agentId: true,
      contract: true,
      holderAddress: true,
      status: true,
      mintedAt: true,
      cachedStars: true,
      cachedFeedbackCount: true,
      cachedValidatorCount: true,
      cachedValidationCount: true,
      cachedAt: true,
      tenant: { select: { displayName: true } },
      user: { select: { displayName: true, email: true } },
    },
  });
  if (!identity) return null;

  const displayName =
    args.kind === 'org'
      ? (identity.tenant?.displayName ?? `Tenant ${args.subjectId}`)
      : (identity.user?.displayName ?? identity.user?.email ?? `Traveler ${args.subjectId}`);

  const recent = await prisma.reputationFeedback.findMany({
    where: { subjectId: identity.id },
    orderBy: { createdAt: 'desc' },
    take: 12,
    select: {
      stars: true,
      score: true,
      tag: true,
      fromAddress: true,
      txHash: true,
      tripId: true,
      bookingId: true,
      createdAt: true,
    },
  });
  const validations = await prisma.validationCheck.findMany({
    where: { subjectId: identity.id },
    orderBy: { createdAt: 'desc' },
    take: 12,
    select: {
      validatorAddress: true,
      requestHash: true,
      responseScore: true,
      tag: true,
      createdAt: true,
      resolvedAt: true,
    },
  });

  return {
    kind: args.kind,
    subjectId: args.subjectId,
    agentId: identity.agentId,
    contract: identity.contract,
    holderAddress: identity.holderAddress,
    status: identity.status as 'pending' | 'minted' | 'failed',
    displayName,
    mintedAt: identity.mintedAt?.toISOString() ?? null,
    stars: identity.cachedStars,
    feedbackCount: identity.cachedFeedbackCount,
    validatorCount: identity.cachedValidatorCount,
    validationCount: identity.cachedValidationCount,
    cachedAt: identity.cachedAt?.toISOString() ?? null,
    recent: recent.map(r => ({
      stars: r.stars,
      score: r.score,
      tag: r.tag,
      fromAddress: r.fromAddress,
      txHash: r.txHash,
      tripId: r.tripId,
      bookingId: r.bookingId,
      createdAt: r.createdAt.toISOString(),
    })),
    validations: validations.map(v => ({
      validatorAddress: v.validatorAddress,
      requestHash: v.requestHash,
      responseScore: v.responseScore,
      tag: v.tag,
      createdAt: v.createdAt.toISOString(),
      resolvedAt: v.resolvedAt?.toISOString() ?? null,
    })),
  };
}

export const loadAgentProfile = unstable_cache(loadAgentProfileFresh, ['agent-profile'], {
  revalidate: 300,
  tags: ['reputation'],
});
