import { prisma } from '@sendero/database';
import { env } from '@sendero/env';
import { KapsoClient, type KapsoWhatsAppFlow } from '@sendero/kapso';

import accommodationFlow from '../../../kapso/shared-whatsapp-flows/flows/accommodation.flow.json';
import ancillariesFlow from '../../../kapso/shared-whatsapp-flows/flows/ancillaries.flow.json';
import bookingChangeFlow from '../../../kapso/shared-whatsapp-flows/flows/booking-change.flow.json';
import carTransferFlow from '../../../kapso/shared-whatsapp-flows/flows/car-transfer.flow.json';
import disruptionHelpFlow from '../../../kapso/shared-whatsapp-flows/flows/disruption-help.flow.json';
import loginSignupFlow from '../../../kapso/shared-whatsapp-flows/flows/login-signup.flow.json';
import nftTripGalleryFlow from '../../../kapso/shared-whatsapp-flows/flows/nft-trip-gallery.flow.json';
import prefundClaimFlow from '../../../kapso/shared-whatsapp-flows/flows/prefund-claim.flow.json';
import quoteApprovalFlow from '../../../kapso/shared-whatsapp-flows/flows/quote-approval.flow.json';
import refundEscrowFlow from '../../../kapso/shared-whatsapp-flows/flows/refund-escrow.flow.json';
import restaurantExperienceFlow from '../../../kapso/shared-whatsapp-flows/flows/restaurant-experience.flow.json';
import supportIntakeFlow from '../../../kapso/shared-whatsapp-flows/flows/support-intake.flow.json';
import tripIntakeFlow from '../../../kapso/shared-whatsapp-flows/flows/trip-intake.flow.json';

type FlowDefinition = {
  key: string;
  title: string;
  json: Record<string, unknown>;
};

const FLOW_DEFINITIONS: FlowDefinition[] = [
  { key: 'login_signup', title: 'Login and signup', json: loginSignupFlow },
  { key: 'trip_intake', title: 'Trip intake', json: tripIntakeFlow },
  { key: 'support_intake', title: 'Support intake', json: supportIntakeFlow },
  { key: 'quote_approval', title: 'Quote approval', json: quoteApprovalFlow },
  { key: 'ancillaries', title: 'Ancillaries', json: ancillariesFlow },
  { key: 'disruption_help', title: 'Disruption help', json: disruptionHelpFlow },
  { key: 'prefund_claim', title: 'Prefunded claim', json: prefundClaimFlow },
  { key: 'booking_change', title: 'Booking change', json: bookingChangeFlow },
  { key: 'accommodation', title: 'Accommodation', json: accommodationFlow },
  { key: 'car_transfer', title: 'Car or transfer', json: carTransferFlow },
  {
    key: 'restaurant_experience',
    title: 'Restaurants and experiences',
    json: restaurantExperienceFlow,
  },
  { key: 'nft_trip_gallery', title: 'NFT trip gallery', json: nftTripGalleryFlow },
  { key: 'refund_escrow', title: 'Refund and escrow', json: refundEscrowFlow },
];

export async function ensureTenantWhatsAppFlows(args: {
  tenantId: string;
  phoneNumberId: string;
  businessAccountId?: string | null;
  tenantDisplayName?: string | null;
}): Promise<{
  ok: boolean;
  registered: number;
  skipped: number;
  errors: Array<{ flowKey: string; error: string }>;
  reason?: string;
}> {
  const apiKey = env.kapsoApiKey();
  if (!apiKey)
    return { ok: false, registered: 0, skipped: 0, errors: [], reason: 'missing_api_key' };
  if (!args.businessAccountId) {
    return {
      ok: false,
      registered: 0,
      skipped: 0,
      errors: [],
      reason: 'missing_business_account_id',
    };
  }

  const flowRegistrations = getWhatsAppFlowRegistrationDelegate();
  if (!flowRegistrations) {
    console.warn('[whatsapp/flows] Prisma WhatsApp Flow registration delegate is unavailable', {
      tenantId: args.tenantId,
      phoneNumberId: args.phoneNumberId,
    });
    return {
      ok: false,
      registered: 0,
      skipped: 0,
      errors: [],
      reason: 'missing_prisma_flow_registration_delegate',
    };
  }

  const kapso = new KapsoClient({ apiKey, baseUrl: env.kapsoApiBaseUrl() });
  const existingRows = await flowRegistrations.findMany({
    where: { tenantId: args.tenantId, phoneNumberId: args.phoneNumberId },
  });
  const existingByKey = new Map(existingRows.map(row => [row.flowKey, row]));

  let remoteFlows: KapsoWhatsAppFlow[] = [];
  try {
    remoteFlows = await kapso.listWhatsAppFlows({ limit: 100 });
  } catch (err) {
    console.warn('[whatsapp/flows] could not list Kapso flows before registration', {
      tenantId: args.tenantId,
      phoneNumberId: args.phoneNumberId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  let registered = 0;
  let skipped = 0;
  const errors: Array<{ flowKey: string; error: string }> = [];

  for (const definition of FLOW_DEFINITIONS) {
    const existing = existingByKey.get(definition.key);
    if (existing?.kapsoFlowId && existing.status !== 'error') {
      skipped++;
      continue;
    }

    const flowName = flowDisplayName(definition, args.tenantDisplayName);
    try {
      const remote =
        findRemoteFlow(remoteFlows, args.phoneNumberId, flowName) ??
        (await kapso.createWhatsAppFlow({
          name: flowName,
          business_account_id: args.businessAccountId,
          phone_number_id: args.phoneNumberId,
          json_version: '7.3',
          data_api_version: '3.0',
          flow_json: definition.json,
        }));

      await flowRegistrations.upsert({
        where: {
          tenantId_phoneNumberId_flowKey: {
            tenantId: args.tenantId,
            phoneNumberId: args.phoneNumberId,
            flowKey: definition.key,
          },
        },
        create: {
          tenantId: args.tenantId,
          phoneNumberId: args.phoneNumberId,
          flowKey: definition.key,
          kapsoFlowId: remote.id,
          metaFlowId: remote.meta_flow_id ?? remote.metaFlowId ?? remote.flow_id ?? null,
          status: normalizeStatus(remote.status),
          mode: normalizeMode(remote.status),
          name: remote.name ?? flowName,
          metadata: {
            source: 'tenant_provisioning',
            hasDataEndpoint: remote.has_data_endpoint ?? remote.hasDataEndpoint ?? null,
          },
        },
        update: {
          kapsoFlowId: remote.id,
          metaFlowId: remote.meta_flow_id ?? remote.metaFlowId ?? remote.flow_id ?? undefined,
          status: normalizeStatus(remote.status),
          mode: normalizeMode(remote.status),
          name: remote.name ?? flowName,
          lastError: null,
          metadata: {
            source: 'tenant_provisioning',
            updatedAt: new Date().toISOString(),
            hasDataEndpoint: remote.has_data_endpoint ?? remote.hasDataEndpoint ?? null,
          },
        },
      });
      registered++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ flowKey: definition.key, error: message });
      await flowRegistrations.upsert({
        where: {
          tenantId_phoneNumberId_flowKey: {
            tenantId: args.tenantId,
            phoneNumberId: args.phoneNumberId,
            flowKey: definition.key,
          },
        },
        create: {
          tenantId: args.tenantId,
          phoneNumberId: args.phoneNumberId,
          flowKey: definition.key,
          kapsoFlowId: `unregistered:${definition.key}`,
          status: 'error',
          mode: 'draft',
          name: flowName,
          lastError: message,
        },
        update: {
          status: 'error',
          lastError: message,
        },
      });
    }
  }

  return {
    ok: errors.length === 0,
    registered,
    skipped,
    errors,
  };
}

type WhatsAppFlowRegistrationDelegate = {
  findMany: (args: { where: { tenantId: string; phoneNumberId: string } }) => Promise<
    Array<{
      flowKey: string;
      kapsoFlowId: string;
      status: string;
    }>
  >;
  upsert: (args: {
    where: {
      tenantId_phoneNumberId_flowKey: {
        tenantId: string;
        phoneNumberId: string;
        flowKey: string;
      };
    };
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }) => Promise<unknown>;
};

function getWhatsAppFlowRegistrationDelegate(): WhatsAppFlowRegistrationDelegate | null {
  const maybePrisma = prisma as typeof prisma & {
    whatsAppFlowRegistration?: WhatsAppFlowRegistrationDelegate;
  };
  return maybePrisma.whatsAppFlowRegistration ?? null;
}

function flowDisplayName(definition: FlowDefinition, tenantDisplayName?: string | null): string {
  const prefix = tenantDisplayName ? tenantDisplayName.replace(/\s+/g, ' ').trim() : 'Sendero';
  return `${prefix} ${definition.title}`.slice(0, 80);
}

function flowPhoneNumberId(flow: KapsoWhatsAppFlow): string | null {
  return flow.phone_number_id ?? flow.phoneNumberId ?? null;
}

function findRemoteFlow(
  flows: KapsoWhatsAppFlow[],
  phoneNumberId: string,
  flowName: string
): KapsoWhatsAppFlow | null {
  return (
    flows.find(flow => flowPhoneNumberId(flow) === phoneNumberId && flow.name === flowName) ?? null
  );
}

function normalizeStatus(status: unknown): string {
  const text = typeof status === 'string' && status.trim() ? status.toLowerCase() : 'draft';
  if (text === 'published' || text === 'active') return 'published';
  if (text === 'disabled' || text === 'error') return text;
  return 'draft';
}

function normalizeMode(status: unknown): string {
  return normalizeStatus(status) === 'published' ? 'published' : 'draft';
}
