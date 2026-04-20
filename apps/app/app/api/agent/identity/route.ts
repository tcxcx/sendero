import { NextResponse } from 'next/server';
import { env } from '@sendero/env';
import { getAgentIdentity, getReputation, IDENTITY_REGISTRY } from '@sendero/arc/identity';

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

  try {
    const agentId = BigInt(agentIdStr);

    const [identity, reputation] = await Promise.all([
      getAgentIdentity(agentId).catch(() => null),
      getReputation(agentId).catch(() => null),
    ]);

    return NextResponse.json({
      agentId: agentIdStr,
      providerAddress,
      stars: reputation?.stars ?? 0,
      meanScore: reputation?.meanScore ?? 0,
      count: reputation?.count ?? 0,
      validators: reputation?.validators ?? 0,
      metadata: identity?.metadata ?? null,
      tokenURI: identity?.tokenURI ?? null,
      // Arcscan doesn't expose a per-tokenId page; link to the contract.
      explorerUrl: `${explorerUrl}/address/${IDENTITY_REGISTRY}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'identity_failed', message }, { status: 500 });
  }
}
