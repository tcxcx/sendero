import { NextResponse } from 'next/server';

import { env } from '@sendero/env';
import { ensureOrgIdentity } from '@sendero/tools/provision-identity';

import { loadAgentProfileFresh } from '@/lib/agent-profile';
import { requireCurrentTenant } from '@/lib/tenant-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/reputation/workspace
 * Returns the active Clerk org / Sendero tenant reputation profile.
 */
export async function GET() {
  const { tenant } = await requireCurrentTenant();
  let profile = await loadAgentProfileFresh({ kind: 'org', subjectId: tenant.id });
  const provisioning: {
    attempted: boolean;
    status: 'not_needed' | 'minted' | 'pending' | 'failed';
    error: string | null;
  } = {
    attempted: false,
    status: profile?.status === 'minted' && profile.agentId ? 'not_needed' : 'pending',
    error: null,
  };

  if (!profile || profile.status !== 'minted' || !profile.agentId) {
    provisioning.attempted = true;
    try {
      await ensureOrgIdentity({ tenantId: tenant.id });
      profile = await loadAgentProfileFresh({ kind: 'org', subjectId: tenant.id });
      provisioning.status = profile?.status === 'minted' && profile.agentId ? 'minted' : 'pending';
    } catch (error) {
      provisioning.status = 'failed';
      provisioning.error =
        error instanceof Error ? error.message : 'Workspace reputation provisioning failed';
    }
  }

  // Explorer URL is chain-dependent.
  //   - Arc: links to the IdentityRegistry contract on Arcscan/Blockscout.
  //   - Sol: links to the minted Core asset (agentId) on Solana
  //     Explorer. The on-chain "contract" for Sol is the Metaplex Agent
  //     Registry program id; the asset address is the user-meaningful
  //     reference, so we point there.
  const isSol = profile?.contract === 'metaplex-agent-registry';
  let contractUrl: string | null = null;
  if (profile?.contract && profile.agentId && isSol) {
    const cluster =
      (process.env.SENDERO_METAPLEX_AGENT_NETWORK ?? '').includes('mainnet') ? '' : '?cluster=devnet';
    contractUrl = `https://explorer.solana.com/address/${profile.agentId}${cluster}`;
  } else if (profile?.contract && !isSol) {
    const explorerUrl = env.arcExplorerUrl();
    contractUrl = `${explorerUrl}/address/${profile.contract}`;
  }

  return NextResponse.json({
    subjectId: tenant.id,
    displayName: tenant.displayName,
    status: profile?.status ?? 'pending',
    agentId: profile?.agentId ?? null,
    contract: profile?.contract ?? null,
    holderAddress: profile?.holderAddress ?? null,
    mintedAt: profile?.mintedAt ?? null,
    cachedAt: profile?.cachedAt ?? null,
    stars: profile?.stars ?? null,
    feedbackCount: profile?.feedbackCount ?? 0,
    validatorCount: profile?.validatorCount ?? 0,
    validationCount: profile?.validationCount ?? 0,
    recent: profile?.recent ?? [],
    validations: profile?.validations ?? [],
    provisioning,
    publicUrl: `/agents/org/${tenant.id}`,
    contractUrl,
  });
}
