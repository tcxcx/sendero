import { NextResponse } from 'next/server';

import { loadAgentProfile } from '@/lib/agent-profile';
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
  const profile = await loadAgentProfile({ kind: 'org', subjectId: tenant.id });

  return NextResponse.json({
    subjectId: tenant.id,
    displayName: tenant.displayName,
    status: profile?.status ?? 'pending',
    agentId: profile?.agentId ?? null,
    stars: profile?.stars ?? null,
    feedbackCount: profile?.feedbackCount ?? 0,
    validatorCount: profile?.validatorCount ?? 0,
    validationCount: profile?.validationCount ?? 0,
    publicUrl: `/agents/org/${tenant.id}`,
  });
}
