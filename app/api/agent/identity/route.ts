import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import {
  getAgentIdentity,
  getReputation,
  IDENTITY_REGISTRY,
} from '@/lib/arc-identity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/agent/identity
 * Returns the Pasillo agent's on-chain identity + aggregated reputation.
 *
 * Falls back to demo data if bootstrap hasn't been run.
 */
export async function GET() {
  const agentIdStr = process.env.PASILLO_AGENT_ID;
  const providerAddress = process.env.PASILLO_PROVIDER_ADDRESS;
  const explorerUrl = env.arcExplorerUrl();

  if (!agentIdStr || !providerAddress) {
    return NextResponse.json({
      agentId: '1337',
      providerAddress: '0x7a2e9a4d8e8f5c1d8e8f5c1d8e8f5c1d8e8fb18c',
      stars: 4.82,
      meanScore: 96.4,
      count: 147,
      validators: 12,
      metadata: {
        name: 'Pasillo Travel Agent',
        description: '(demo mode — run bootstrap-agent to see live data)',
        version: '1.0.0',
      },
      explorerUrl: `${explorerUrl}/address/${IDENTITY_REGISTRY}`,
      demo: true,
    });
  }

  try {
    const agentId = BigInt(agentIdStr);

    // Fetch identity + reputation in parallel. Both have their own caching.
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
      explorerUrl: `${explorerUrl}/token/${IDENTITY_REGISTRY}/${agentIdStr}`,
      demo: false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: 'identity_failed', message },
      { status: 500 },
    );
  }
}
