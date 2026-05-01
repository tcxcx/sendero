/**
 * GET /api/channels/whatsapp/install
 *
 * Live snapshot of the active tenant's WhatsAppInstall row. The wizard's
 * VerifyNumberPane polls this every few seconds while the operator
 * completes Meta Embedded Signup in the Kapso-hosted page — once the
 * `whatsapp.phone_number.created` webhook lands and writes
 * `phoneNumberId`, the pane enables Continue and the wizard advances.
 *
 * Tenant-scoped via `requireCurrentTenant()`.
 */

import { NextResponse } from 'next/server';

import { prisma } from '@sendero/database';
import { readSetupLinkSnapshot } from '@sendero/kapso';

import { currentOrgPlanTier } from '@/lib/billing-plan';
import { requireCurrentTenant } from '@/lib/tenant-context';
import { readWhatsappHealth } from '@/lib/whatsapp-health';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const { tenant } = await requireCurrentTenant();
  const plan = await currentOrgPlanTier();
  const install = await prisma.whatsAppInstall.findUnique({
    where: { tenantId: tenant.id },
    select: {
      status: true,
      phoneNumberId: true,
      displayPhoneNumber: true,
      businessDisplayName: true,
      kapsoCustomerId: true,
      kapsoConnectionId: true,
      lastErrorMessage: true,
      metadata: true,
    },
  });
  if (!install) {
    return NextResponse.json({
      install: null,
      plan,
      readiness: readinessForPlan(plan),
    });
  }
  const setupLink = readSetupLinkSnapshot(install.metadata);
  const health = install.phoneNumberId ? await readWhatsappHealth(install.phoneNumberId) : null;
  return NextResponse.json({
    plan,
    readiness: readinessForPlan(plan),
    install: {
      status: install.status,
      phoneNumberId: install.phoneNumberId,
      displayPhoneNumber: install.displayPhoneNumber,
      businessDisplayName: install.businessDisplayName,
      kapsoCustomerId: install.kapsoCustomerId,
      kapsoConnectionId: install.kapsoConnectionId,
      lastErrorMessage: install.lastErrorMessage,
      setupLinkUrl: setupLink?.url ?? null,
      setupLinkExpiresAt: setupLink?.expires_at ?? null,
      setupLinkStatus: setupLink?.status ?? null,
      setupLinkError: setupLink?.whatsapp_setup_error ?? null,
      setupLinkProvisionPhoneNumber: setupLink?.provision_phone_number ?? null,
      provisioned: install.status === 'active' && Boolean(install.phoneNumberId),
      health,
    },
  });
}

function readinessForPlan(plan: string) {
  return {
    canConnectProductionNumber: plan !== 'free',
    requiresUpgrade: plan === 'free',
    message:
      plan === 'free'
        ? 'WhatsApp tenant operations require a dedicated business number on a paid plan.'
        : 'Connect a dedicated WhatsApp Business number to activate tenant operations.',
  };
}
