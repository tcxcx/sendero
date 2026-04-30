import { NextResponse } from 'next/server';

import { loadAgentProfileFresh } from '@/lib/agent-profile';
import { requireCurrentTenant } from '@/lib/tenant-context';
import { ensureOrgIdentity } from '@sendero/tools/provision-identity';

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
  });
}
