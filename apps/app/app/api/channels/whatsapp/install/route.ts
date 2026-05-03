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

import { auth } from '@clerk/nextjs/server';
import { type Prisma, prisma } from '@sendero/database';
import { env } from '@sendero/env';
import { KapsoClient, type KapsoWhatsAppPhoneNumber, readSetupLinkSnapshot } from '@sendero/kapso';

import { currentOrgPlanTier } from '@/lib/billing-plan';
import { requireCurrentTenant } from '@/lib/tenant-context';
import { ensureTenantWhatsAppFlows } from '@/lib/whatsapp-flow-registry';
import { readWhatsappHealth } from '@/lib/whatsapp-health';
import { isMetaMockPhoneNumber, META_MOCK_PHONE_NUMBER_MESSAGE } from '@/lib/whatsapp-mock-number';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const { tenant } = await requireCurrentTenant();
  const plan = await currentOrgPlanTier();
  console.info('[whatsapp/install] snapshot request', {
    tenantId: tenant.id,
    plan,
  });
  let install = await prisma.whatsAppInstall.findUnique({
    where: { tenantId: tenant.id },
    select: installSelect,
  });
  if (!install) {
    console.info('[whatsapp/install] no install row', { tenantId: tenant.id });
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
  const sandbox = isSandboxInstall(install.metadata);
  const health =
    install.phoneNumberId && !sandbox ? await readWhatsappHealth(install.phoneNumberId) : null;
  console.info('[whatsapp/install] snapshot response', {
    tenantId: tenant.id,
    installId: install.id,
    status: install.status,
    phoneNumberId: install.phoneNumberId,
    displayPhoneNumber: install.displayPhoneNumber,
    setupLinkStatus: setupLink?.whatsapp_setup_status ?? setupLink?.status ?? null,
    setupLinkError: setupLink?.whatsapp_setup_error ?? null,
    provisioned: install.status === 'active' && Boolean(install.phoneNumberId),
    health: health
      ? {
          status: health.status,
          messagingStatus: health.messagingStatus,
          webhookVerified: health.webhookVerified,
        }
      : null,
  });
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
      sandbox,
      health,
    },
  });
}

export async function DELETE() {
  try {
    const { tenant, userId } = await requireCurrentTenant();
    const { has } = await auth();
    if (!has({ role: 'org:admin' })) {
      console.warn('[whatsapp/install] disconnect forbidden', { tenantId: tenant.id, userId });
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const existing = await prisma.whatsAppInstall.findUnique({
      where: { tenantId: tenant.id },
      select: {
        id: true,
        status: true,
        kapsoCustomerId: true,
        phoneNumberId: true,
        displayPhoneNumber: true,
        businessAccountId: true,
      },
    });
    if (!existing) {
      console.info('[whatsapp/install] disconnect no-op; no install row', {
        tenantId: tenant.id,
        userId,
      });
      return NextResponse.json({ ok: true, disconnected: false });
    }

    const flowRegistrationDelegate = (
      prisma as typeof prisma & {
        whatsAppFlowRegistration?: {
          deleteMany: typeof prisma.whatsAppInstall.deleteMany;
        };
      }
    ).whatsAppFlowRegistration;
    const transaction = flowRegistrationDelegate
      ? [
          flowRegistrationDelegate.deleteMany({
            where: { tenantId: tenant.id },
          }),
          prisma.whatsAppInstall.delete({
            where: { id: existing.id },
          }),
        ]
      : [
          prisma.whatsAppInstall.delete({
            where: { id: existing.id },
          }),
        ];
    await prisma.$transaction(transaction);
    await prisma.session
      .deleteMany({
        where: { tenantId: tenant.id, subjectKey: 'channels:whatsapp' },
      })
      .catch(() => {});

    console.info('[whatsapp/install] disconnected locally', {
      tenantId: tenant.id,
      userId,
      installId: existing.id,
      previousStatus: existing.status,
      kapsoCustomerId: existing.kapsoCustomerId,
      phoneNumberId: existing.phoneNumberId,
      displayPhoneNumber: existing.displayPhoneNumber,
      businessAccountId: existing.businessAccountId,
    });

    return NextResponse.json({
      ok: true,
      disconnected: true,
      phoneNumberId: existing.phoneNumberId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[whatsapp/install] disconnect failed', { error: message });
    return NextResponse.json({ error: 'disconnect_failed', message }, { status: 500 });
  }
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
  if (isMetaMockPhoneNumber(args.install.displayPhoneNumber)) {
    console.warn('[whatsapp/install] refusing Meta mock phone number install', {
      tenantId: args.tenantId,
      installId: args.install.id,
      phoneNumberId: args.install.phoneNumberId,
      displayPhoneNumber: args.install.displayPhoneNumber,
    });
    return await prisma.whatsAppInstall.update({
      where: { id: args.install.id },
      data: {
        status: 'error',
        phoneNumberId: null,
        kapsoConnectionId: null,
        lastErrorMessage: META_MOCK_PHONE_NUMBER_MESSAGE,
        metadata: mergeJsonObject(args.install.metadata, {
          metaMockPhoneNumberRejectedAt: new Date().toISOString(),
          metaMockPhoneNumber: args.install.displayPhoneNumber,
          metaMockPhoneNumberId: args.install.phoneNumberId,
        }),
      },
      select: installSelect,
    });
  }
  if (args.install.status === 'active' && args.install.phoneNumberId) return args.install;
  if (args.install.status === 'disabled') {
    console.info('[whatsapp/install] skipping Kapso reconciliation for disabled install', {
      tenantId: args.tenantId,
      installId: args.install.id,
      kapsoCustomerId: args.install.kapsoCustomerId,
    });
    return args.install;
  }

  const apiKey = env.kapsoApiKey();
  if (!apiKey) {
    console.warn('[whatsapp/install] cannot reconcile; KAPSO_API_KEY missing', {
      tenantId: args.tenantId,
      installId: args.install.id,
    });
    return args.install;
  }

  try {
    const kapso = new KapsoClient({ apiKey, baseUrl: env.kapsoApiBaseUrl() });
    console.info('[whatsapp/install] reconciling pending install from Kapso', {
      tenantId: args.tenantId,
      installId: args.install.id,
      kapsoCustomerId: args.install.kapsoCustomerId,
      status: args.install.status,
    });
    const installWithFreshSetupLink = await refreshSetupLinkSnapshot(kapso, args.install);
    const phoneNumber = await findProvisionedPhoneNumberForTenant(kapso, {
      tenantId: args.tenantId,
      currentCustomerId: installWithFreshSetupLink.kapsoCustomerId,
    });
    if (!phoneNumber) {
      console.info('[whatsapp/install] no provisioned phone number found in Kapso', {
        tenantId: args.tenantId,
        installId: installWithFreshSetupLink.id,
        kapsoCustomerId: installWithFreshSetupLink.kapsoCustomerId,
      });
      return await clearStaleRefreshFallbackError(installWithFreshSetupLink);
    }
    if (isMetaMockPhoneNumber(phoneNumber.display_phone_number)) {
      console.warn(
        '[whatsapp/install] Kapso returned Meta mock phone number during reconciliation',
        {
          tenantId: args.tenantId,
          installId: installWithFreshSetupLink.id,
          phoneNumberId: phoneNumber.phone_number_id,
          displayPhoneNumber: phoneNumber.display_phone_number,
        }
      );
      return await prisma.whatsAppInstall.update({
        where: { id: installWithFreshSetupLink.id },
        data: {
          status: 'error',
          phoneNumberId: null,
          kapsoConnectionId: null,
          displayPhoneNumber: null,
          businessDisplayName: null,
          lastErrorMessage: META_MOCK_PHONE_NUMBER_MESSAGE,
          metadata: mergeJsonObject(installWithFreshSetupLink.metadata, {
            metaMockPhoneNumberRejectedAt: new Date().toISOString(),
            metaMockPhoneNumber: phoneNumber.display_phone_number,
            metaMockPhoneNumberId: phoneNumber.phone_number_id,
          }),
        },
        select: installSelect,
      });
    }
    console.info('[whatsapp/install] found Kapso phone number for pending install', {
      tenantId: args.tenantId,
      installId: installWithFreshSetupLink.id,
      phoneNumberId: phoneNumber.phone_number_id,
      businessAccountId:
        phoneNumber.business_account_id ?? installWithFreshSetupLink.businessAccountId,
      displayPhoneNumber: phoneNumber.display_phone_number ?? null,
      status: phoneNumber.status ?? null,
    });

    const activation = await activateTenantWorkflowTrigger({
      tenantId: args.tenantId,
      tenantDisplayName: args.tenantDisplayName,
      phoneNumberId: phoneNumber.phone_number_id,
      displayPhoneNumber: phoneNumber.display_phone_number ?? undefined,
    });
    let tenantFlows: unknown;
    try {
      tenantFlows = await ensureTenantWhatsAppFlows({
        tenantId: args.tenantId,
        tenantDisplayName: args.tenantDisplayName,
        phoneNumberId: phoneNumber.phone_number_id,
        businessAccountId:
          phoneNumber.business_account_id ?? installWithFreshSetupLink.businessAccountId,
      });
    } catch (err) {
      tenantFlows = {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        checkedAt: new Date().toISOString(),
      };
      console.warn('[whatsapp/install] tenant flow registration failed after phone activation', {
        tenantId: args.tenantId,
        phoneNumberId: phoneNumber.phone_number_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    console.info('[whatsapp/install] Kapso reconciliation side effects complete', {
      tenantId: args.tenantId,
      installId: installWithFreshSetupLink.id,
      phoneNumberId: phoneNumber.phone_number_id,
      activationStatus: activation.status ?? null,
      tenantFlows,
    });

    return await prisma.whatsAppInstall.update({
      where: { id: installWithFreshSetupLink.id },
      data: {
        status: 'active',
        kapsoCustomerId: phoneNumber.customer_id ?? installWithFreshSetupLink.kapsoCustomerId,
        phoneNumberId: phoneNumber.phone_number_id,
        businessAccountId: phoneNumber.business_account_id ?? undefined,
        displayPhoneNumber:
          phoneNumber.display_phone_number ?? installWithFreshSetupLink.displayPhoneNumber,
        businessDisplayName:
          phoneNumber.verified_name ?? installWithFreshSetupLink.businessDisplayName,
        kapsoConnectionId: phoneNumber.phone_number_id,
        lastHealthyAt: new Date(),
        lastErrorMessage: null,
        metadata: mergeJsonObject(installWithFreshSetupLink.metadata, {
          tenantWorkflow: activation,
          tenantFlows,
          reconciledFromKapsoAt: new Date().toISOString(),
          reconciledFromKapsoReason:
            phoneNumber.customer_id &&
            phoneNumber.customer_id !== installWithFreshSetupLink.kapsoCustomerId
              ? 'install_refresh_duplicate_display_phone_number_fallback'
              : 'install_refresh_fallback',
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

async function refreshSetupLinkSnapshot(
  kapso: KapsoClient,
  install: InstallForSnapshot
): Promise<InstallForSnapshot> {
  const setupLink = readSetupLinkSnapshot(install.metadata);
  if (!setupLink?.id) return install;
  try {
    const fresh = await kapso.getSetupLink(setupLink.id);
    return await prisma.whatsAppInstall.update({
      where: { id: install.id },
      data: {
        metadata: mergeJsonObject(install.metadata, {
          setupLink: {
            id: fresh.id,
            url: fresh.url,
            expires_at: fresh.expires_at,
            status: fresh.status,
            success_redirect_url: fresh.success_redirect_url ?? null,
            failure_redirect_url: fresh.failure_redirect_url ?? null,
            provision_phone_number: fresh.provision_phone_number,
            allowed_connection_types: fresh.allowed_connection_types,
            whatsapp_setup_status: fresh.whatsapp_setup_status ?? null,
            whatsapp_setup_error: fresh.whatsapp_setup_error ?? null,
          },
        }),
      },
      select: installSelect,
    });
  } catch (err) {
    console.warn('[whatsapp/install] setup link status refresh failed', {
      installId: install.id,
      setupLinkId: setupLink.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return install;
  }
}

async function clearStaleRefreshFallbackError(
  install: InstallForSnapshot
): Promise<InstallForSnapshot> {
  if (!install.lastErrorMessage?.startsWith('Kapso refresh fallback failed:')) return install;
  return await prisma.whatsAppInstall.update({
    where: { id: install.id },
    data: { lastErrorMessage: null },
    select: installSelect,
  });
}

async function findProvisionedPhoneNumberForTenant(
  kapso: KapsoClient,
  args: { tenantId: string; currentCustomerId: string }
): Promise<KapsoWhatsAppPhoneNumber | null> {
  const phoneNumbers = await kapso.listPhoneNumbersForCustomer(args.currentCustomerId);
  const currentCustomerPhoneNumber = selectProvisionedPhoneNumber(phoneNumbers);
  if (currentCustomerPhoneNumber) return currentCustomerPhoneNumber;

  const allPhoneNumbers = await kapso.listPhoneNumbers();
  const candidatePhoneNumbers = allPhoneNumbers.filter(
    item =>
      item.customer_id &&
      item.customer_id !== args.currentCustomerId &&
      !isMetaMockPhoneNumber(item.display_phone_number) &&
      Boolean(item.phone_number_id)
  );
  for (const phoneNumber of candidatePhoneNumbers) {
    let customer: Awaited<ReturnType<KapsoClient['getCustomer']>>;
    try {
      customer = await kapso.getCustomer(phoneNumber.customer_id!);
    } catch (err) {
      console.warn('[whatsapp/install] skipped Kapso phone number with unreadable customer', {
        tenantId: args.tenantId,
        currentCustomerId: args.currentCustomerId,
        candidateCustomerId: phoneNumber.customer_id,
        phoneNumberId: phoneNumber.phone_number_id,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    const externalCustomerId = customer.external_customer_id ?? '';
    if (
      externalCustomerId === args.tenantId ||
      externalCustomerId.startsWith(`${args.tenantId}:`)
    ) {
      console.info('[whatsapp/install] found tenant phone number on prior Kapso customer', {
        tenantId: args.tenantId,
        currentCustomerId: args.currentCustomerId,
        recoveredCustomerId: phoneNumber.customer_id,
        recoveredExternalCustomerId: externalCustomerId,
        phoneNumberId: phoneNumber.phone_number_id,
        displayPhoneNumber: phoneNumber.display_phone_number ?? null,
      });
      return phoneNumber;
    }
  }

  return null;
}

function selectProvisionedPhoneNumber(
  phoneNumbers: KapsoWhatsAppPhoneNumber[]
): KapsoWhatsAppPhoneNumber | null {
  const realPhoneNumbers = phoneNumbers.filter(
    item => !isMetaMockPhoneNumber(item.display_phone_number)
  );
  return (
    realPhoneNumbers.find(item => /active|connected|available/i.test(item.status ?? '')) ??
    realPhoneNumbers.find(item => Boolean(item.phone_number_id)) ??
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

function isSandboxInstall(metadata: Prisma.JsonValue | null): boolean {
  const record =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : {};
  return record.sandbox === true || record.source === 'provider_sandbox';
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
