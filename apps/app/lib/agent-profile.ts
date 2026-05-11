/**
 * Server-side loader for the public on-chain agent profile pages.
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

import { getAgentIdentity, getReputation, IDENTITY_REGISTRY } from '@sendero/arc/identity';
import { prisma } from '@sendero/database';
import { env } from '@sendero/env';

import { loadMirroredReputation } from '@/lib/reputation-mirror';

export interface AgentProfile {
  kind: 'org' | 'user' | 'sendero';
  subjectId: string;
  /**
   * Settlement chain for the displayed identity row. Drives every
   * "View on …" link, registry name, and chain label on the public
   * profile. For org profiles, Tenant.primaryChain picks the displayed
   * row when both Arc and Sol identities exist.
   */
  chain: 'arc' | 'sol';
  agentId: string | null;
  contract: string;
  holderAddress: string;
  providerAddress?: string | null;
  status: 'pending' | 'minted' | 'failed';
  displayName: string;
  description?: string | null;
  tokenURI?: string | null;
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
  // Phase 5.x — read via the chain-aware mirror so dual-chain
  // tenants surface aggregated stars + counts on the public profile.
  // Mirror returns null when no identity exists on any chain.
  const mirror = await loadMirroredReputation(args);
  if (!mirror) return null;

  // Display name comes from tenant/user — read it independently
  // (the mirror doesn't carry it; identity rows are FK-joined to
  // Tenant/User but we want a single read regardless of chain).
  let displayName: string;
  let tenantPrimaryChain: 'arc' | 'sol' | null = null;
  if (args.kind === 'org') {
    const tenant = await prisma.tenant.findUnique({
      where: { id: args.subjectId },
      select: { displayName: true, primaryChain: true },
    });
    displayName = tenant?.displayName ?? `Tenant ${args.subjectId}`;
    tenantPrimaryChain = tenant?.primaryChain === 'sol' ? 'sol' : 'arc';
  } else {
    const user = await prisma.user.findUnique({
      where: { id: args.subjectId },
      select: { displayName: true, email: true },
    });
    displayName = user?.displayName ?? user?.email ?? `Traveler ${args.subjectId}`;
  }

  const primaryChain: 'arc' | 'sol' =
    tenantPrimaryChain && mirror.perChain[tenantPrimaryChain]
      ? tenantPrimaryChain
      : mirror.perChain.arc
        ? 'arc'
        : 'sol';
  const primary = mirror.perChain[primaryChain];
  if (!primary) return null;

  // Recent feedback + validations span all chains for this subject.
  // ReputationFeedback FK is OnchainIdentity.id, so we query for the
  // ids of every chain row.
  const identityIds = [mirror.perChain.arc?.identityId, mirror.perChain.sol?.identityId].filter(
    (id): id is string => Boolean(id)
  );

  const [recent, validations] = await Promise.all([
    prisma.reputationFeedback.findMany({
      where: { subjectId: { in: identityIds } },
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
    }),
    prisma.validationCheck.findMany({
      where: { subjectId: { in: identityIds } },
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
    }),
  ]);

  return {
    kind: args.kind,
    subjectId: args.subjectId,
    chain: primaryChain,
    agentId: primary.agentId,
    contract: primary.contract,
    holderAddress: primary.holderAddress,
    status: primary.status as 'pending' | 'minted' | 'failed',
    displayName,
    mintedAt: primary.mintedAt?.toISOString() ?? null,
    // Mirror-folded values: weighted-average stars + summed counts.
    stars: mirror.stars,
    feedbackCount: mirror.feedbackCount,
    validatorCount: mirror.validatorCount,
    validationCount: mirror.validationCount,
    cachedAt: mirror.cachedAt?.toISOString() ?? null,
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

export async function loadSenderoAgentProfileFresh(): Promise<AgentProfile | null> {
  const agentId = env.senderoAgentTokenId();
  const providerAddress = process.env.SENDERO_PROVIDER_ADDRESS ?? null;
  if (!agentId || !providerAddress) return null;

  const [identity, reputation, indexed] = await Promise.all([
    getAgentIdentity(BigInt(agentId)).catch(() => null),
    getReputation(BigInt(agentId)).catch(() => null),
    prisma.onchainIdentity.findFirst({
      where: { agentId },
      select: {
        id: true,
        contract: true,
        holderAddress: true,
        status: true,
        mintedAt: true,
        cachedStars: true,
        cachedFeedbackCount: true,
        cachedValidatorCount: true,
        cachedValidationCount: true,
        cachedAt: true,
      },
    }),
  ]);

  const recent = indexed
    ? await prisma.reputationFeedback.findMany({
        where: { subjectId: indexed.id },
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
      })
    : [];
  const validations = indexed
    ? await prisma.validationCheck.findMany({
        where: { subjectId: indexed.id },
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
      })
    : [];

  return {
    kind: 'sendero',
    subjectId: agentId,
    // Sendero's primary platform agent lives on Arc ERC-8004; the
    // workspace-level chip routes per tenant chain in its own loader.
    chain: 'arc',
    agentId,
    contract: indexed?.contract ?? IDENTITY_REGISTRY,
    holderAddress: indexed?.holderAddress ?? providerAddress,
    providerAddress,
    status: (indexed?.status as 'pending' | 'minted' | 'failed' | undefined) ?? 'minted',
    displayName: identity?.metadata?.name ?? 'Sendero Travel Agent',
    description:
      identity?.metadata?.description ??
      'Sendero primary AI travel agent. Books, settles, and records reputation on Arc Testnet.',
    tokenURI: identity?.tokenURI ?? null,
    mintedAt: indexed?.mintedAt?.toISOString() ?? null,
    stars: reputation?.stars ?? indexed?.cachedStars ?? null,
    feedbackCount: reputation?.count ?? indexed?.cachedFeedbackCount ?? 0,
    validatorCount: reputation?.validators ?? indexed?.cachedValidatorCount ?? 0,
    validationCount: indexed?.cachedValidationCount ?? validations.length,
    cachedAt: indexed?.cachedAt?.toISOString() ?? null,
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

export const loadSenderoAgentProfile = unstable_cache(
  loadSenderoAgentProfileFresh,
  ['sendero-agent-profile'],
  {
    revalidate: 300,
    tags: ['reputation'],
  }
);
