/**
 * GET /api/billing/plan-context
 *
 * Returns the current org's plan tier + key numeric limits so the
 * client-side settings UI can render "3 production keys" etc. without
 * shipping @sendero/billing/plans to the browser.
 */

import { NextResponse } from 'next/server';

import { env } from '@sendero/env';

import { currentOrgPlan } from '@/lib/billing-plan';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const plan = await currentOrgPlan();
  return NextResponse.json({
    tier: plan.tier,
    productionApiKeyLimit: plan.productionApiKeyLimit,
    workspaceLimit: plan.workspaceLimit,
    isBeta: env.isTestnetBeta(),
  });
}
