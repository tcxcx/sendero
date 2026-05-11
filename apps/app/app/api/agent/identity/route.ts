import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

import { getAgentIdentity, getReputation, IDENTITY_REGISTRY } from '@sendero/arc/identity';
import { prisma } from '@sendero/database';
import { env } from '@sendero/env';

// Solana Agent Registry program id — same constant as
// @sendero/metaplex/register-tenant-agent. Inlined to keep this route
// node-runtime cheap (no umi import).
const SOL_AGENT_REGISTRY_PROGRAM_ID = '1DREGFgysWYxLnRnKQnwrxnJQeSMk2HmGaC6whw2B2p';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/agent/identity
 * Returns the Sendero agent's on-chain identity + aggregated reputation.
 */
export async function GET() {
  const agentIdStr = process.env.SENDERO_AGENT_ID;
  const providerAddress = process.env.SENDERO_PROVIDER_ADDRESS;
  const explorerUrl = env.arcExplorerUrl();

  if (!agentIdStr || !providerAddress) {
    return NextResponse.json(
      {
        error: 'agent_not_bootstrapped',
        message:
          'Run `bun run scripts/bootstrap-agent.ts` to mint the agent and populate .env.local.',
      },
      { status: 503 }
    );
  }

  // Tenant chain controls the explorer URL the chip renders. Arc tenants
  // see Arcscan; Sol tenants see Solana Explorer pointed at the Agent
  // Registry program (Phase 4.x will land per-tenant Sol agent assets,
  // at which point this links to the asset directly). Defaults to 'arc'
  // when no Clerk org is selected (e.g. landing-shell discovery hits).
  let workspaceChain: 'arc' | 'sol' = 'arc';
  try {
    const { orgId } = await auth();
    if (orgId) {
      const tenant = await prisma.tenant.findUnique({
        where: { clerkOrgId: orgId },
        select: { primaryChain: true },
      });
      if (tenant?.primaryChain === 'sol') workspaceChain = 'sol';
    }
  } catch {
    /* unauthenticated — keep default 'arc' */
  }

  try {
    const agentId = BigInt(agentIdStr);

    const [identity, reputation] = await Promise.all([
      getAgentIdentity(agentId).catch(() => null),
      getReputation(agentId).catch(() => null),
    ]);
    const indexed = await prisma.onchainIdentity.findFirst({
      where: { agentId: agentIdStr },
      select: {
        id: true,
        contract: true,
        holderAddress: true,
        status: true,
        mintedAt: true,
        cachedAt: true,
        received: {
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
        },
        validations: {
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
        },
      },
    });

    const contract = indexed?.contract ?? IDENTITY_REGISTRY;
    // Pick the explorer the chip should link to. Arc workspaces see the
    // ERC-8004 IdentityRegistry on Arcscan; Sol workspaces see the
    // Metaplex Agent Registry program on Solana Explorer (devnet during
    // testnet beta).
    const chipUrl =
      workspaceChain === 'sol'
        ? `https://explorer.solana.com/address/${SOL_AGENT_REGISTRY_PROGRAM_ID}?cluster=devnet`
        : `${explorerUrl}/address/${contract}`;

    return NextResponse.json({
      agentId: agentIdStr,
      providerAddress,
      chain: workspaceChain,
      stars: reputation?.stars ?? 0,
      meanScore: reputation?.meanScore ?? 0,
      count: reputation?.count ?? 0,
      validators: reputation?.validators ?? 0,
      metadata: identity?.metadata ?? null,
      tokenURI: identity?.tokenURI ?? null,
      indexed: indexed
        ? {
            contract: indexed.contract,
            holderAddress: indexed.holderAddress,
            status: indexed.status,
            mintedAt: indexed.mintedAt?.toISOString() ?? null,
            cachedAt: indexed.cachedAt?.toISOString() ?? null,
          }
        : null,
      recent:
        indexed?.received.map(r => ({
          stars: r.stars,
          score: r.score,
          tag: r.tag,
          fromAddress: r.fromAddress,
          txHash: r.txHash,
          tripId: r.tripId,
          bookingId: r.bookingId,
          createdAt: r.createdAt.toISOString(),
        })) ?? [],
      validations:
        indexed?.validations.map(v => ({
          validatorAddress: v.validatorAddress,
          requestHash: v.requestHash,
          responseScore: v.responseScore,
          tag: v.tag,
          createdAt: v.createdAt.toISOString(),
          resolvedAt: v.resolvedAt?.toISOString() ?? null,
        })) ?? [],
      publicUrl: `/agents/sendero/${agentIdStr}`,
      // Workspace-chain-aware: Arcscan for arc, Solana Explorer for sol.
      contractUrl: chipUrl,
      explorerUrl: chipUrl,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'identity_failed', message }, { status: 500 });
  }
}
