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

import { type Prisma, prisma } from '@sendero/database';
import { env } from '@sendero/env';
import { KapsoClient, type KapsoWhatsAppPhoneNumber, readSetupLinkSnapshot } from '@sendero/kapso';

import { currentOrgPlanTier } from '@/lib/billing-plan';
import { requireCurrentTenant } from '@/lib/tenant-context';
import { ensureTenantWhatsAppFlows } from '@/lib/whatsapp-flow-registry';
import { readWhatsappHealth } from '@/lib/whatsapp-health';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const { tenant } = await requireCurrentTenant();
  const plan = await currentOrgPlanTier();
  let install = await prisma.whatsAppInstall.findUnique({
    where: { tenantId: tenant.id },
    select: installSelect,
  });
  if (!install) {
    return NextResponse.json({
      install: null,
      plan,
      readiness: readinessForPlan(plan),
    });
  }
  install = await reconcilePendingInstallFromKapso({
    tenantId: tenant.id,
    tenantDisplayName: tenant.displayName,
    install,
  });
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
      businessAccountId: install.businessAccountId,
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

type InstallForSnapshot = {
  id: string;
  status: string;
  phoneNumberId: string | null;
  displayPhoneNumber: string | null;
  businessDisplayName: string | null;
  businessAccountId: string | null;
  kapsoCustomerId: string;
  kapsoConnectionId: string | null;
  lastErrorMessage: string | null;
  metadata: Prisma.JsonValue | null;
};

async function reconcilePendingInstallFromKapso(args: {
  tenantId: string;
  tenantDisplayName: string;
  install: InstallForSnapshot;
}): Promise<InstallForSnapshot> {
  if (args.install.status === 'active' && args.install.phoneNumberId) return args.install;

  const apiKey = env.kapsoApiKey();
  if (!apiKey) return args.install;

  try {
    const kapso = new KapsoClient({ apiKey, baseUrl: env.kapsoApiBaseUrl() });
    const phoneNumber = await findProvisionedPhoneNumber(kapso, args.install.kapsoCustomerId);
    if (!phoneNumber) return args.install;

    const activation = await activateTenantWorkflowTrigger({
      tenantId: args.tenantId,
      tenantDisplayName: args.tenantDisplayName,
      phoneNumberId: phoneNumber.phone_number_id,
      displayPhoneNumber: phoneNumber.display_phone_number ?? undefined,
    });
    const tenantFlows = await ensureTenantWhatsAppFlows({
      tenantId: args.tenantId,
      tenantDisplayName: args.tenantDisplayName,
      phoneNumberId: phoneNumber.phone_number_id,
      businessAccountId: phoneNumber.business_account_id ?? args.install.businessAccountId,
    });

    return await prisma.whatsAppInstall.update({
      where: { id: args.install.id },
      data: {
        status: 'active',
        phoneNumberId: phoneNumber.phone_number_id,
        businessAccountId: phoneNumber.business_account_id ?? undefined,
        displayPhoneNumber: phoneNumber.display_phone_number ?? args.install.displayPhoneNumber,
        businessDisplayName: phoneNumber.verified_name ?? args.install.businessDisplayName,
        kapsoConnectionId: phoneNumber.phone_number_id,
        lastHealthyAt: new Date(),
        lastErrorMessage: null,
        metadata: mergeJsonObject(args.install.metadata, {
          tenantWorkflow: activation,
          tenantFlows,
          reconciledFromKapsoAt: new Date().toISOString(),
          reconciledFromKapsoReason: 'install_refresh_fallback',
        }),
      },
      select: installSelect,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[whatsapp/install] Kapso refresh reconciliation failed', {
      tenantId: args.tenantId,
      kapsoCustomerId: args.install.kapsoCustomerId,
      error: message,
    });
    return await prisma.whatsAppInstall.update({
      where: { id: args.install.id },
      data: {
        lastErrorMessage: `Kapso refresh fallback failed: ${message}`,
      },
      select: installSelect,
    });
  }
}

async function findProvisionedPhoneNumber(
  kapso: KapsoClient,
  kapsoCustomerId: string
): Promise<KapsoWhatsAppPhoneNumber | null> {
  const phoneNumbers = await kapso.listPhoneNumbersForCustomer(kapsoCustomerId);
  return (
    phoneNumbers.find(item => /active|connected|available/i.test(item.status ?? '')) ??
    phoneNumbers.find(item => Boolean(item.phone_number_id)) ??
    null
  );
}

async function activateTenantWorkflowTrigger(args: {
  tenantId: string;
  tenantDisplayName: string;
  phoneNumberId: string;
  displayPhoneNumber?: string;
}): Promise<Record<string, unknown>> {
  const workflowId = env.kapsoTenantWorkflowId();
  const apiKey = env.kapsoApiKey();
  if (!workflowId || !apiKey) {
    return {
      status: 'skipped',
      reason: !workflowId ? 'missing_KAPSO_TENANT_WORKFLOW_ID' : 'missing_KAPSO_API_KEY',
      checkedAt: new Date().toISOString(),
    };
  }

  const kapso = new KapsoClient({ apiKey, baseUrl: env.kapsoApiBaseUrl() });
  const result: Record<string, unknown> = {
    workflowId,
    phoneNumberId: args.phoneNumberId,
    displayPhoneNumber: args.displayPhoneNumber ?? null,
    checkedAt: new Date().toISOString(),
    source: 'install_refresh_fallback',
  };

  try {
    result.health = await kapso.checkPhoneHealth(args.phoneNumberId);
  } catch (err) {
    result.healthError = err instanceof Error ? err.message : String(err);
  }

  try {
    const trigger = await kapso.createWorkflowTrigger(workflowId, {
      trigger_type: 'inbound_message',
      phone_number_id: args.phoneNumberId,
      display_name: `Sendero tenant ${args.tenantDisplayName}`,
      active: true,
    });
    result.status = 'active';
    result.triggerId = trigger.id;
  } catch (err) {
    result.status = 'error';
    result.error = err instanceof Error ? err.message : String(err);
  }

  return result;
}

function mergeJsonObject(current: unknown, patch: Record<string, unknown>): Prisma.InputJsonObject {
  const base =
    current && typeof current === 'object' && !Array.isArray(current)
      ? (current as Record<string, unknown>)
      : {};
  return { ...base, ...patch } as Prisma.InputJsonObject;
}

const installSelect = {
  id: true,
  status: true,
  phoneNumberId: true,
  displayPhoneNumber: true,
  businessDisplayName: true,
  businessAccountId: true,
  kapsoCustomerId: true,
  kapsoConnectionId: true,
  lastErrorMessage: true,
  metadata: true,
} satisfies Prisma.WhatsAppInstallSelect;

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
