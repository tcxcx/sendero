import { NextResponse } from 'next/server';

import { type Prisma, prisma } from '@sendero/database';
import { KapsoClient, readSetupLinkSnapshot } from '@sendero/kapso';
import {
  extractTraceId,
  flushLangfuse,
  scoreLatency,
  scoreToolSuccess,
  traceAgent,
} from '@sendero/langfuse';
import { ensureTravelerWallet } from '@sendero/tools/ensure-traveler-wallet';
import { buildOtpComponents, SENDERO_TEMPLATES } from '@sendero/whatsapp/templates';

import crypto from 'node:crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SupportTool =
  | 'get_tenant_operating_context'
  | 'create_trip_intake'
  | 'create_whatsapp_login_signup'
  | 'get_whatsapp_session_context'
  | 'request_whatsapp_otp'
  | 'verify_whatsapp_otp'
  | 'create_tenant_handoff'
  | 'create_quote_request'
  | 'list_quote_options'
  | 'request_quote_approval'
  | 'create_prefunded_trip_link'
  | 'get_prefund_claim_status'
  | 'request_payment_link'
  | 'get_booking_context'
  | 'request_booking_change'
  | 'search_accommodation'
  | 'create_accommodation_request'
  | 'search_car_rentals'
  | 'create_transfer_request'
  | 'search_restaurants'
  | 'create_ancillary_request'
  | 'get_trip_gallery'
  | 'get_nft_stamp_status'
  | 'request_nft_unlock'
  | 'get_disruption_context'
  | 'create_disruption_handoff'
  | 'get_wallet_context'
  | 'get_tenant_context'
  | 'get_whatsapp_setup_status'
  | 'get_tenant_whatsapp_flow'
  | 'upsert_tenant_whatsapp_flow'
  | 'get_recent_channel_events'
  | 'get_trip_context'
  | 'get_billing_context'
  | 'get_escrow_context'
  | 'search_sendero_docs'
  | 'create_support_ticket'
  | 'update_support_ticket';

interface SupportToolBody {
  operation?: SupportTool;
  input?: Record<string, unknown>;
  execution_context?: {
    context?: {
      contact?: { profile_name?: unknown };
      phone_number?: unknown;
      [key: string]: unknown;
    };
    system?: {
      flow_execution_id?: unknown;
      workflow_execution_id?: unknown;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  whatsapp_context?: {
    conversation?: Record<string, unknown>;
    messages?: Array<Record<string, unknown>>;
  };
}

interface VerifiedSupportContext {
  billingTier?: string;
  clerkOrgId?: string;
  exp: number;
  iat: number;
  locale?: string;
  plan?: string;
  tenantId: string;
  tenantSlug?: string;
  v: 1;
}

function withTrace(data: unknown, traceId: string): unknown {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return { ...data, traceId };
  }
  return { ok: true, data, traceId };
}

function configuredSecret(): string | null {
  return (
    process.env.SUPPORT_TOOLS_SECRET?.trim() || process.env.KAPSO_WEBHOOK_SECRET?.trim() || null
  );
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(50, Math.trunc(parsed)));
}

function asBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string')
    return ['1', 'true', 'yes', 'all', 'list'].includes(value.toLowerCase());
  return false;
}

function linesFromContext(body: SupportToolBody): string[] {
  const messages = body.whatsapp_context?.messages ?? [];
  return messages
    .map(message => asString(message.content))
    .filter((content): content is string => Boolean(content))
    .flatMap(content => content.split(/\r?\n/));
}

function fieldFromDashboardContext(body: SupportToolBody, label: string): string | null {
  const pattern = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*(.+)$`, 'i');
  for (const line of linesFromContext(body)) {
    const match = line.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function supportRefFromContext(body: SupportToolBody): string | null {
  const input = body.input ?? {};
  return (
    asString(input.support_ref) ??
    asString(input.supportRef) ??
    fieldFromDashboardContext(body, 'Support ref')
  );
}

function phoneNumberIdFromContext(body: SupportToolBody): string | null {
  const input = body.input ?? {};
  const conversation = body.whatsapp_context?.conversation ?? {};
  const context = body.execution_context?.context ?? {};
  const candidates = [
    input.phone_number_id,
    input.phoneNumberId,
    conversation.phone_number_id,
    conversation.phoneNumberId,
    conversation.whatsapp_phone_number_id,
    conversation.whatsappPhoneNumberId,
    (conversation.whatsapp_config as Record<string, unknown> | undefined)?.phone_number_id,
    (conversation.whatsapp_config as Record<string, unknown> | undefined)?.phoneNumberId,
    context.phone_number_id,
    context.phoneNumberId,
    context.whatsapp_phone_number_id,
  ];
  for (const candidate of candidates) {
    const value = asString(candidate);
    if (value) return value;
  }
  return null;
}

function trustedPhoneNumberIdFromContext(body: SupportToolBody): string | null {
  const conversation = body.whatsapp_context?.conversation ?? {};
  const context = body.execution_context?.context ?? {};
  const candidates = [
    conversation.phone_number_id,
    conversation.phoneNumberId,
    conversation.whatsapp_phone_number_id,
    conversation.whatsappPhoneNumberId,
    (conversation.whatsapp_config as Record<string, unknown> | undefined)?.phone_number_id,
    (conversation.whatsapp_config as Record<string, unknown> | undefined)?.phoneNumberId,
    context.phone_number_id,
    context.phoneNumberId,
    context.whatsapp_phone_number_id,
  ];
  for (const candidate of candidates) {
    const value = asString(candidate);
    if (value) return value;
  }
  return null;
}

function trustedBusinessScopedUserIdFromContext(body: SupportToolBody): string | null {
  const conversation = body.whatsapp_context?.conversation ?? {};
  const context = body.execution_context?.context ?? {};
  const candidates = [
    conversation.business_scoped_user_id,
    conversation.businessScopedUserId,
    conversation.wa_id,
    conversation.waId,
    context.business_scoped_user_id,
    context.businessScopedUserId,
  ];
  for (const candidate of candidates) {
    const value = asString(candidate);
    if (value) return value;
  }
  return null;
}

function trustedWhatsappPhoneFromContext(body: SupportToolBody): string | null {
  const conversation = body.whatsapp_context?.conversation ?? {};
  const context = body.execution_context?.context ?? {};
  const candidates = [
    conversation.phone_number,
    conversation.phoneNumber,
    conversation.wa_id,
    conversation.waId,
    context.phone_number,
    context.phoneNumber,
  ];
  for (const candidate of candidates) {
    const value = asString(candidate);
    if (value) return value;
  }
  return null;
}

function maskIdentifier(value: unknown): string | null {
  const text = asString(value);
  if (!text) return null;
  if (text.length <= 4) return '****';
  return `...${text.slice(-4)}`;
}

function safeText(value: unknown, max = 2000): string | null {
  const text = asString(value);
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function normalizeEmail(value: unknown): string | null {
  const text = asString(value)?.toLowerCase();
  if (!text || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return null;
  return text;
}

function normalizeIso3(value: unknown): string | null {
  const text = asString(value)?.toUpperCase();
  return text && /^[A-Z]{3}$/.test(text) ? text : null;
}

const WHATSAPP_FLOW_KEYS = new Set([
  'login_signup',
  'trip_intake',
  'support_intake',
  'quote_approval',
  'ancillaries',
  'disruption_help',
  'prefund_claim',
  'booking_change',
  'accommodation',
  'car_transfer',
  'restaurant_experience',
  'nft_trip_gallery',
  'refund_escrow',
]);

function normalizeFlowKey(value: unknown): string | null {
  const text = asString(value)?.toLowerCase().replace(/-/g, '_');
  return text && WHATSAPP_FLOW_KEYS.has(text) ? text : null;
}

function normalizeFlowMode(value: unknown): 'draft' | 'published' {
  return asString(value)?.toLowerCase() === 'published' ? 'published' : 'draft';
}

function normalizeDate(value: unknown): string | null {
  const text = asString(value);
  if (!text || !/^\d{4}-\d{2}(-\d{2})?$/.test(text)) return null;
  return text.length === 7 ? `${text}-01` : text;
}

function otpSecret(): string {
  const secret = configuredSecret();
  if (!secret) throw new Error('SUPPORT_TOOLS_SECRET is required for WhatsApp OTP hashing');
  return secret;
}

function hashOtp(args: {
  tenantId: string;
  channelIdentityId: string;
  nonce: string;
  code: string;
  purpose: string;
}): string {
  return crypto
    .createHmac('sha256', otpSecret())
    .update(`${args.tenantId}:${args.channelIdentityId}:${args.nonce}:${args.purpose}:${args.code}`)
    .digest('hex');
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function verifySupportContextToken(token: string | null): VerifiedSupportContext | null {
  if (!token) return null;
  const secret = configuredSecret();
  if (!secret) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== actualBuffer.length) return null;
  if (!crypto.timingSafeEqual(expectedBuffer, actualBuffer)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const context = parsed as Partial<VerifiedSupportContext>;
  const now = Math.floor(Date.now() / 1000);
  const tenantId = asString(context.tenantId);
  if (context.v !== 1 || !tenantId || typeof context.exp !== 'number') return null;
  if (context.exp < now) return null;
  return {
    v: 1,
    tenantId,
    tenantSlug: asString(context.tenantSlug) ?? undefined,
    clerkOrgId: asString(context.clerkOrgId) ?? undefined,
    plan: asString(context.plan) ?? undefined,
    billingTier: asString(context.billingTier) ?? undefined,
    locale: asString(context.locale) ?? undefined,
    iat: typeof context.iat === 'number' ? context.iat : 0,
    exp: context.exp,
  };
}

function verifiedSupportContext(body: SupportToolBody): VerifiedSupportContext | null {
  const input = body.input ?? {};
  return verifySupportContextToken(
    asString(input.support_context_token) ??
      asString(input.supportContextToken) ??
      fieldFromDashboardContext(body, 'Support context token')
  );
}

async function resolveTenant(body: SupportToolBody) {
  const phoneNumberId = trustedPhoneNumberIdFromContext(body);
  if (phoneNumberId) {
    const install = await prisma.whatsAppInstall.findFirst({
      where: { phoneNumberId, status: 'active' },
      orderBy: { updatedAt: 'desc' },
      include: { tenant: true },
    });
    if (install?.tenant) return install.tenant;
  }

  const supportRef = supportRefFromContext(body);
  if (supportRef) {
    const rows = await prisma.$queryRaw<Array<{ tenant_id: string }>>`
      UPDATE support_context_sessions
      SET last_used_at = now()
      WHERE code = ${supportRef} AND expires_at > now()
      RETURNING tenant_id
    `;
    const tenantId = rows[0]?.tenant_id;
    if (tenantId) {
      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
      if (tenant) return tenant;
    }
  }

  const verified = verifiedSupportContext(body);

  if (verified?.tenantId) {
    const tenant = await prisma.tenant.findUnique({ where: { id: verified.tenantId } });
    if (tenant) return tenant;
  }
  if (verified?.tenantSlug) {
    const tenant = await prisma.tenant.findUnique({ where: { slug: verified.tenantSlug } });
    if (tenant) return tenant;
  }
  if (verified?.clerkOrgId) {
    const tenant = await prisma.tenant.findUnique({ where: { clerkOrgId: verified.clerkOrgId } });
    if (tenant) return tenant;
  }

  const bsuid = trustedBusinessScopedUserIdFromContext(body);
  const phone = trustedWhatsappPhoneFromContext(body);
  if (bsuid || phone) {
    const identities = await prisma.channelIdentity.findMany({
      where: {
        kind: 'whatsapp',
        OR: [
          ...(bsuid ? [{ businessScopedUserId: bsuid }] : []),
          ...(phone ? [{ externalUserId: phone }, { businessScopedUserId: phone }] : []),
        ],
      },
      orderBy: { updatedAt: 'desc' },
      take: 2,
      include: { tenant: true },
    });
    const tenantIds = new Set(identities.map(identity => identity.tenantId));
    if (tenantIds.size === 1 && identities[0]?.tenant) return identities[0].tenant;
  }

  return null;
}

function tenantVerificationError(body: SupportToolBody) {
  const input = body.input ?? {};
  const attemptedTenantLookup =
    asString(input.tenant_id) ??
    asString(input.tenantId) ??
    asString(input.tenant_slug) ??
    asString(input.tenantSlug) ??
    asString(input.clerk_org_id) ??
    asString(input.clerkOrgId) ??
    fieldFromDashboardContext(body, 'Tenant ID') ??
    fieldFromDashboardContext(body, 'Tenant slug') ??
    fieldFromDashboardContext(body, 'Clerk org ID');
  if (!attemptedTenantLookup || verifiedSupportContext(body) || supportRefFromContext(body)) {
    return null;
  }
  return {
    ok: false,
    error: 'tenant_verification_required',
    message:
      'Tenant-specific support tools require a signed Sendero dashboard support context token or a tenant-bound WhatsApp identity.',
  };
}

async function requireResolvedTenant(body: SupportToolBody) {
  const verificationError = tenantVerificationError(body);
  if (verificationError) return { tenant: null, error: verificationError };
  const tenant = await resolveTenant(body);
  if (!tenant) return { tenant: null, error: { ok: false, error: 'tenant_not_found' } };
  return { tenant, error: null };
}

function supportContext(body: SupportToolBody) {
  const input = body.input ?? {};
  return {
    input,
    phoneNumberId: trustedPhoneNumberIdFromContext(body),
    workflowExecutionId:
      asString(body.execution_context?.system?.workflow_execution_id) ??
      asString(body.execution_context?.system?.flow_execution_id),
    whatsappConversationId: asString(body.whatsapp_context?.conversation?.id),
    whatsappPhoneNumber:
      asString(body.execution_context?.context?.phone_number) ??
      asString(body.whatsapp_context?.conversation?.phone_number),
    whatsappProfileName:
      asString(body.execution_context?.context?.contact?.profile_name) ??
      asString(body.whatsapp_context?.conversation?.profile_name),
  };
}

function sanitizedInput(input: Record<string, unknown>) {
  const redactedKeys = new Set([
    'support_context_token',
    'supportContextToken',
    'token',
    'secret',
    'api_key',
    'apiKey',
    'pat',
    'password',
  ]);
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [
      key,
      redactedKeys.has(key) ? '[redacted]' : typeof value === 'string' ? safeText(value) : value,
    ])
  );
}

function sanitizedSupportContext(body: SupportToolBody): Prisma.InputJsonObject {
  const context = supportContext(body);
  const messages = body.whatsapp_context?.messages ?? [];
  const recentMessages = messages.slice(-5).map(message => ({
    id: asString(message.id),
    direction: asString(message.direction),
    messageType: asString(message.message_type) ?? asString(message.messageType),
    createdAt: asString(message.created_at) ?? asString(message.createdAt),
    hasMedia: Boolean(message.has_media ?? message.hasMedia),
    contentPreview: safeText(message.content, 500),
  }));
  return {
    input: sanitizedInput(body.input ?? {}) as Prisma.InputJsonObject,
    workflowExecutionId: context.workflowExecutionId ?? null,
    whatsappConversationId: context.whatsappConversationId ?? null,
    whatsappPhoneNumber: maskIdentifier(context.whatsappPhoneNumber),
    whatsappProfileName: context.whatsappProfileName ?? null,
    recentMessages,
  };
}

async function getTenantContext(body: SupportToolBody) {
  const { tenant, error } = await requireResolvedTenant(body);
  if (!tenant) return error;
  const [subscription, memberships, trips, identities, whatsappInstall, recentTickets] =
    await Promise.all([
      prisma.subscription.findUnique({ where: { tenantId: tenant.id } }),
      prisma.membership.count({ where: { tenantId: tenant.id, status: 'active' } }),
      prisma.trip.count({ where: { tenantId: tenant.id } }),
      prisma.channelIdentity.groupBy({
        by: ['kind'],
        where: { tenantId: tenant.id },
        _count: { _all: true },
      }),
      prisma.whatsAppInstall.findUnique({ where: { tenantId: tenant.id } }),
      listSupportTickets(tenant.id, 5),
    ]);

  return {
    ok: true,
    tenant: {
      id: tenant.id,
      slug: tenant.slug,
      displayName: tenant.displayName,
      clerkOrgId: tenant.clerkOrgId,
      billingTier: tenant.billingTier,
      fiscalCountry: tenant.fiscalCountry,
      arcAddress: tenant.arcAddress,
      parentTenantId: tenant.parentTenantId,
      createdAt: tenant.createdAt,
      updatedAt: tenant.updatedAt,
    },
    subscription,
    counts: {
      activeMemberships: memberships,
      trips,
      channelIdentities: identities.map(row => ({ kind: row.kind, count: row._count._all })),
    },
    whatsapp: whatsappInstall
      ? {
          status: whatsappInstall.status,
          phoneNumberId: whatsappInstall.phoneNumberId,
          businessAccountId: whatsappInstall.businessAccountId,
          displayPhoneNumber: whatsappInstall.displayPhoneNumber,
          businessDisplayName: whatsappInstall.businessDisplayName,
          lastHealthyAt: whatsappInstall.lastHealthyAt,
          lastErrorMessage: whatsappInstall.lastErrorMessage,
        }
      : null,
    recentTickets,
  };
}

async function getTenantWhatsAppFlow(body: SupportToolBody) {
  const { tenant, error } = await requireResolvedTenant(body);
  if (!tenant) return error;

  const input = body.input ?? {};
  const flowKey = normalizeFlowKey(input.flow_key ?? input.flowKey);
  if (!flowKey) {
    return {
      ok: false,
      configured: false,
      error: 'invalid_flow_key',
      allowedFlowKeys: Array.from(WHATSAPP_FLOW_KEYS),
    };
  }

  const phoneNumberId = phoneNumberIdFromContext(body);
  if (!phoneNumberId) {
    return { ok: false, configured: false, error: 'phone_number_id_required', flowKey };
  }

  const install = await prisma.whatsAppInstall.findUnique({
    where: { tenantId: tenant.id },
    select: { phoneNumberId: true, status: true, displayPhoneNumber: true },
  });
  if (!install?.phoneNumberId || install.phoneNumberId !== phoneNumberId) {
    return {
      ok: false,
      configured: false,
      error: 'tenant_phone_number_mismatch',
      flowKey,
      phoneNumberId,
      tenantPhoneNumberId: install?.phoneNumberId ?? null,
    };
  }

  const registration = await prisma.whatsAppFlowRegistration.findUnique({
    where: {
      tenantId_phoneNumberId_flowKey: {
        tenantId: tenant.id,
        phoneNumberId,
        flowKey,
      },
    },
  });

  if (!registration || registration.status === 'disabled') {
    return {
      ok: true,
      configured: false,
      flowKey,
      phoneNumberId,
      tenant: {
        id: tenant.id,
        slug: tenant.slug,
        displayName: tenant.displayName,
      },
      reason: registration?.status === 'disabled' ? 'flow_disabled' : 'flow_not_registered',
    };
  }

  return {
    ok: true,
    configured: true,
    flowKey,
    phoneNumberId,
    flow: {
      id: registration.id,
      kapsoFlowId: registration.kapsoFlowId,
      metaFlowId: registration.metaFlowId,
      status: registration.status,
      mode: registration.mode,
      name: registration.name,
      dataEndpointId: registration.dataEndpointId,
      lastError: registration.lastError,
    },
    tenant: {
      id: tenant.id,
      slug: tenant.slug,
      displayName: tenant.displayName,
    },
  };
}

async function upsertTenantWhatsAppFlow(body: SupportToolBody) {
  const { tenant, error } = await requireResolvedTenant(body);
  if (!tenant) return error;

  const input = body.input ?? {};
  const flowKey = normalizeFlowKey(input.flow_key ?? input.flowKey);
  const phoneNumberId = phoneNumberIdFromContext(body);
  const kapsoFlowId = asString(input.kapso_flow_id) ?? asString(input.kapsoFlowId);
  if (!flowKey || !phoneNumberId || !kapsoFlowId) {
    return {
      ok: false,
      error: 'invalid_flow_registration',
      required: ['flow_key', 'phone_number_id', 'kapso_flow_id'],
      allowedFlowKeys: Array.from(WHATSAPP_FLOW_KEYS),
    };
  }

  const install = await prisma.whatsAppInstall.findUnique({
    where: { tenantId: tenant.id },
    select: { phoneNumberId: true },
  });
  if (!install?.phoneNumberId || install.phoneNumberId !== phoneNumberId) {
    return {
      ok: false,
      error: 'tenant_phone_number_mismatch',
      phoneNumberId,
      tenantPhoneNumberId: install?.phoneNumberId ?? null,
    };
  }

  const registration = await prisma.whatsAppFlowRegistration.upsert({
    where: {
      tenantId_phoneNumberId_flowKey: {
        tenantId: tenant.id,
        phoneNumberId,
        flowKey,
      },
    },
    create: {
      tenantId: tenant.id,
      phoneNumberId,
      flowKey,
      kapsoFlowId,
      metaFlowId: asString(input.meta_flow_id) ?? asString(input.metaFlowId),
      status: asString(input.status) ?? 'draft',
      mode: normalizeFlowMode(input.mode),
      name: asString(input.name),
      dataEndpointId: asString(input.data_endpoint_id) ?? asString(input.dataEndpointId),
      lastError: asString(input.last_error) ?? asString(input.lastError),
      metadata: {
        registeredBy: 'support_tools',
        registeredAt: new Date().toISOString(),
      },
    },
    update: {
      kapsoFlowId,
      metaFlowId: asString(input.meta_flow_id) ?? asString(input.metaFlowId) ?? undefined,
      status: asString(input.status) ?? undefined,
      mode: normalizeFlowMode(input.mode),
      name: asString(input.name) ?? undefined,
      dataEndpointId:
        asString(input.data_endpoint_id) ?? asString(input.dataEndpointId) ?? undefined,
      lastError: asString(input.last_error) ?? asString(input.lastError),
      metadata: {
        registeredBy: 'support_tools',
        updatedAt: new Date().toISOString(),
      },
    },
  });

  return {
    ok: true,
    configured: true,
    flowKey,
    phoneNumberId,
    flow: {
      id: registration.id,
      kapsoFlowId: registration.kapsoFlowId,
      metaFlowId: registration.metaFlowId,
      status: registration.status,
      mode: registration.mode,
      name: registration.name,
      dataEndpointId: registration.dataEndpointId,
      lastError: registration.lastError,
    },
  };
}

function isFreeTenant(tenant: { billingTier: unknown }): boolean {
  return String(tenant.billingTier ?? 'free').toLowerCase() === 'free';
}

async function getTenantOperatingContext(body: SupportToolBody) {
  const { tenant, error } = await requireResolvedTenant(body);
  if (!tenant) return error;
  const [subscription, whatsappInstall, slackInstall, trips, recentTickets] = await Promise.all([
    prisma.subscription.findUnique({ where: { tenantId: tenant.id } }),
    prisma.whatsAppInstall.findUnique({ where: { tenantId: tenant.id } }),
    prisma.slackInstall.findFirst({
      where: { tenantId: tenant.id, revokedAt: null },
      orderBy: { installedAt: 'desc' },
      select: { id: true, teamName: true, teamId: true, botUserId: true, routing: true },
    }),
    prisma.trip.findMany({
      where: { tenantId: tenant.id },
      orderBy: { updatedAt: 'desc' },
      take: 5,
      select: {
        id: true,
        status: true,
        intent: true,
        totalUsdc: true,
        createdAt: true,
        updatedAt: true,
        traveler: { select: { id: true, displayName: true, email: true, phone: true } },
        bookings: {
          orderBy: { createdAt: 'desc' },
          take: 3,
          select: { id: true, kind: true, status: true, totalUsd: true, pnr: true },
        },
      },
    }),
    listSupportTickets(tenant.id, 8),
  ]);
  const context = supportContext(body);
  const sandbox = isFreeTenant(tenant);
  return {
    ok: true,
    mode: sandbox ? 'sandbox' : 'production',
    sandbox,
    tenant: {
      id: tenant.id,
      slug: tenant.slug,
      displayName: tenant.displayName,
      billingTier: tenant.billingTier,
      fiscalCountry: tenant.fiscalCountry,
      arcAddress: tenant.arcAddress,
    },
    subscription,
    whatsapp: whatsappInstall
      ? {
          status: whatsappInstall.status,
          phoneNumberId: whatsappInstall.phoneNumberId,
          displayPhoneNumber: whatsappInstall.displayPhoneNumber,
          businessDisplayName: whatsappInstall.businessDisplayName,
          lastHealthyAt: whatsappInstall.lastHealthyAt,
          lastErrorMessage: whatsappInstall.lastErrorMessage,
        }
      : null,
    handoff: {
      primary: 'web_internal',
      webInternalAvailable: true,
      slackConfigured: Boolean(slackInstall),
      slack: slackInstall,
      whatsappOperatorConfigured: Boolean(
        (whatsappInstall?.metadata as Record<string, unknown> | null | undefined)
          ?.operatorHandoffPhone
      ),
    },
    recentTrips: trips,
    recentHandoffs: recentTickets,
    channel: {
      phoneNumberId: context.phoneNumberId,
      whatsappConversationId: context.whatsappConversationId,
      customerPhoneMasked: maskIdentifier(context.whatsappPhoneNumber),
      profileName: context.whatsappProfileName,
    },
    restrictions: sandbox
      ? [
          'Sandbox mode: no production templates, customer broadcasts, payment movement, wallet transfers, booking commits, refunds, or escrow settlement.',
          'Create internal web handoffs for human decisions.',
        ]
      : [],
  };
}

async function createTripIntake(body: SupportToolBody) {
  const { tenant, error } = await requireResolvedTenant(body);
  if (!tenant) return error;
  const input = body.input ?? {};
  const context = supportContext(body);
  const sandbox = isFreeTenant(tenant);
  const title = asString(input.title) ?? asString(input.summary) ?? 'WhatsApp trip intake';
  const travelerName =
    asString(input.traveler_name) ?? asString(input.travelerName) ?? context.whatsappProfileName;
  const travelerPhone =
    asString(input.traveler_phone) ??
    asString(input.travelerPhone) ??
    context.whatsappPhoneNumber ??
    null;
  const intent = {
    source: 'kapso_whatsapp',
    sandbox,
    title,
    travelerName,
    travelerPhone,
    origin: asString(input.origin),
    destination: asString(input.destination),
    dates: asString(input.dates),
    budget: asString(input.budget),
    purpose: asString(input.purpose),
    notes: safeText(input.notes ?? input.summary, 2000),
  };
  const trip = await prisma.trip.create({
    data: {
      tenantId: tenant.id,
      intent: intent as Prisma.InputJsonValue,
      status: 'draft',
      metadata: {
        source: 'kapso_whatsapp_tenant_agent',
        sandbox,
        whatsappConversationId: context.whatsappConversationId,
        workflowExecutionId: context.workflowExecutionId,
      } as Prisma.InputJsonValue,
      guestVerifiedContacts: travelerPhone
        ? ({ phone: travelerPhone } as Prisma.InputJsonValue)
        : undefined,
      channelBindings: {
        primary: 'whatsapp',
        notifyChannels: ['web'],
      } as Prisma.InputJsonValue,
    },
    select: {
      id: true,
      status: true,
      intent: true,
      metadata: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  await prisma.supportTurn.create({
    data: {
      tenantId: tenant.id,
      tripId: trip.id,
      turnSummary: title,
      outcome: sandbox ? 'deflected' : 'answered',
      rawIo: {
        kind: 'trip_intake',
        sandbox,
        whatsappConversationId: context.whatsappConversationId,
      } as Prisma.InputJsonValue,
    },
  });
  return { ok: true, sandbox, trip };
}

async function createWhatsappLoginSignup(body: SupportToolBody) {
  const { tenant, error } = await requireResolvedTenant(body);
  if (!tenant) return error;

  const input = body.input ?? {};
  const context = supportContext(body);
  const email = normalizeEmail(
    input.email ?? input.ticket_delivery_email ?? input.ticketDeliveryEmail
  );
  if (!email) return { ok: false, error: 'valid_email_required' };
  const existingUser = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, displayName: true, phone: true, metadata: true },
  });
  const accountMode = existingUser ? 'login' : 'signup';
  const trustedIdentity = await resolveTrustedWhatsappIdentity(body, tenant.id);
  const trustedSession = trustedIdentity
    ? verifiedSessionFromMetadata(trustedIdentity.metadata)
    : null;
  const canMutateExistingUser =
    Boolean(existingUser) &&
    Boolean(trustedSession?.verified) &&
    trustedIdentity?.userId === existingUser?.id;
  if (existingUser && !canMutateExistingUser) {
    await prisma.supportTurn.create({
      data: {
        tenantId: tenant.id,
        turnSummary: `WhatsApp traveler login requires verification for ${email}`,
        outcome: 'deflected',
        rawIo: {
          kind: 'whatsapp_login_signup',
          accountMode: 'login_pending_verification',
          reason: 'existing_email_requires_verified_session',
          flowToken: asString(input.flow_token),
        } as Prisma.InputJsonValue,
      },
    });
    return {
      ok: false,
      error: 'email_verification_required',
      accountMode: 'login_pending_verification',
      tenant: { id: tenant.id, slug: tenant.slug },
      message:
        'This email already belongs to a Sendero user. Complete email/passkey verification or a verified WhatsApp session already linked to that user before linking this chat.',
    };
  }

  const displayName =
    asString(input.display_name) ??
    asString(input.displayName) ??
    asString(input.name) ??
    context.whatsappProfileName ??
    email.split('@')[0];
  const profilePhone =
    asString(input.phone) ??
    asString(input.phone_number) ??
    asString(input.phoneNumber) ??
    context.whatsappPhoneNumber;
  const channelPhone = trustedWhatsappPhoneFromContext(body);
  const locale = asString(input.locale) ?? asString(input.language) ?? undefined;
  const nationalityIso3 = normalizeIso3(input.nationality_iso3 ?? input.nationalityIso3);
  const passportExpiry = normalizeDate(input.passport_expiry ?? input.passportExpiry);

  const travelerProfile: Record<string, unknown> = {
    ...(existingUser?.metadata &&
    typeof existingUser.metadata === 'object' &&
    !Array.isArray(existingUser.metadata) &&
    'travelerProfile' in existingUser.metadata &&
    existingUser.metadata.travelerProfile &&
    typeof existingUser.metadata.travelerProfile === 'object'
      ? (existingUser.metadata.travelerProfile as Record<string, unknown>)
      : {}),
    source: 'whatsapp_flow',
    accountMode,
    emailVerified: Boolean(canMutateExistingUser),
    locale: locale ?? null,
    ticketDeliveryEmail: email,
    linkedAt: new Date().toISOString(),
  };
  if (nationalityIso3) travelerProfile.declaredNationalityIso3 = nationalityIso3;
  if (passportExpiry) travelerProfile.declaredPassportExpiry = passportExpiry;

  const user = await prisma.user.upsert({
    where: { email },
    create: {
      email,
      displayName,
      phone: profilePhone ?? channelPhone,
      source: 'whatsapp',
      metadata: { travelerProfile } as Prisma.InputJsonValue,
      lastSeenAt: new Date(),
    },
    update: {
      displayName,
      phone: profilePhone ?? channelPhone ?? undefined,
      lastSeenAt: new Date(),
      metadata: {
        travelerProfile,
      } as Prisma.InputJsonValue,
    },
    select: {
      id: true,
      email: true,
      displayName: true,
      phone: true,
      source: true,
      metadata: true,
      mscaAddress: true,
    },
  });

  await prisma.membership.upsert({
    where: { tenantId_userId: { tenantId: tenant.id, userId: user.id } },
    create: {
      tenantId: tenant.id,
      userId: user.id,
      role: 'traveler',
      status: canMutateExistingUser ? 'active' : 'invited',
      invitedAt: canMutateExistingUser ? undefined : new Date(),
      joinedAt: canMutateExistingUser ? new Date() : undefined,
    },
    update: {
      status: canMutateExistingUser ? 'active' : 'invited',
      joinedAt: canMutateExistingUser ? new Date() : undefined,
    },
  });

  const bsuid = trustedBusinessScopedUserIdFromContext(body);
  let channelIdentity = null;
  if (bsuid) {
    channelIdentity = await prisma.channelIdentity.upsert({
      where: {
        tenantId_kind_businessScopedUserId: {
          tenantId: tenant.id,
          kind: 'whatsapp',
          businessScopedUserId: bsuid,
        },
      },
      create: {
        tenantId: tenant.id,
        userId: user.id,
        kind: 'whatsapp',
        businessScopedUserId: bsuid,
        externalUserId: channelPhone,
        username: displayName,
        metadata: {
          locale,
          source: 'whatsapp_login_signup_flow',
          emailVerified: Boolean(canMutateExistingUser),
        } as Prisma.InputJsonValue,
      },
      update: {
        userId: user.id,
        externalUserId: channelPhone ?? undefined,
        username: displayName,
        metadata: {
          locale,
          source: 'whatsapp_login_signup_flow',
          emailVerified: Boolean(canMutateExistingUser),
        } as Prisma.InputJsonValue,
      },
      select: { id: true, kind: true, externalUserId: true, businessScopedUserId: true },
    });
  } else if (channelPhone) {
    channelIdentity = await prisma.channelIdentity.upsert({
      where: {
        tenantId_kind_externalUserId: {
          tenantId: tenant.id,
          kind: 'whatsapp',
          externalUserId: channelPhone,
        },
      },
      create: {
        tenantId: tenant.id,
        userId: user.id,
        kind: 'whatsapp',
        externalUserId: channelPhone,
        username: displayName,
        metadata: {
          locale,
          source: 'whatsapp_login_signup_flow',
          emailVerified: Boolean(canMutateExistingUser),
        } as Prisma.InputJsonValue,
      },
      update: {
        userId: user.id,
        username: displayName,
        metadata: {
          locale,
          source: 'whatsapp_login_signup_flow',
          emailVerified: Boolean(canMutateExistingUser),
        } as Prisma.InputJsonValue,
      },
      select: { id: true, kind: true, externalUserId: true, businessScopedUserId: true },
    });
  }

  const wallet = canMutateExistingUser ? await ensureTravelerWallet({ userId: user.id }) : null;
  await prisma.supportTurn.create({
    data: {
      tenantId: tenant.id,
      turnSummary: canMutateExistingUser
        ? `WhatsApp traveler account linked for ${email}`
        : `WhatsApp traveler account staged for ${email}`,
      outcome: wallet ? 'answered' : 'deflected',
      rawIo: {
        kind: 'whatsapp_login_signup',
        accountMode,
        emailVerified: Boolean(canMutateExistingUser),
        userId: user.id,
        channelIdentityId: channelIdentity?.id ?? null,
        walletProvisioned: Boolean(wallet),
        flowToken: asString(input.flow_token),
      } as Prisma.InputJsonValue,
    },
  });

  return {
    ok: true,
    accountMode: canMutateExistingUser ? accountMode : 'signup_pending_email_verification',
    tenant: { id: tenant.id, slug: tenant.slug },
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      phone: maskIdentifier(user.phone),
      source: user.source,
    },
    channelIdentity: channelIdentity
      ? {
          ...channelIdentity,
          externalUserId: maskIdentifier(channelIdentity.externalUserId),
          businessScopedUserId: maskIdentifier(channelIdentity.businessScopedUserId),
        }
      : null,
    walletProvisioned: Boolean(wallet),
  };
}

async function resolveOrCreateWhatsappIdentity(body: SupportToolBody, tenantId: string) {
  const input = body.input ?? {};
  const context = supportContext(body);
  const bsuid = trustedBusinessScopedUserIdFromContext(body);
  const phone = trustedWhatsappPhoneFromContext(body) ?? context.whatsappPhoneNumber;
  const username =
    asString(input.display_name) ??
    asString(input.displayName) ??
    asString(input.name) ??
    context.whatsappProfileName;
  const locale = asString(input.locale) ?? asString(input.language);

  if (bsuid) {
    return prisma.channelIdentity.upsert({
      where: {
        tenantId_kind_businessScopedUserId: {
          tenantId,
          kind: 'whatsapp',
          businessScopedUserId: bsuid,
        },
      },
      create: {
        tenantId,
        kind: 'whatsapp',
        businessScopedUserId: bsuid,
        externalUserId: phone,
        username,
        metadata: { locale, source: 'whatsapp_session' } as Prisma.InputJsonValue,
      },
      update: {
        externalUserId: phone ?? undefined,
        username: username ?? undefined,
      },
      select: {
        id: true,
        tenantId: true,
        userId: true,
        externalUserId: true,
        businessScopedUserId: true,
        username: true,
        metadata: true,
      },
    });
  }

  if (!phone) return null;
  return prisma.channelIdentity.upsert({
    where: {
      tenantId_kind_externalUserId: {
        tenantId,
        kind: 'whatsapp',
        externalUserId: phone,
      },
    },
    create: {
      tenantId,
      kind: 'whatsapp',
      externalUserId: phone,
      username,
      metadata: { locale, source: 'whatsapp_session' } as Prisma.InputJsonValue,
    },
    update: {
      username: username ?? undefined,
    },
    select: {
      id: true,
      tenantId: true,
      userId: true,
      externalUserId: true,
      businessScopedUserId: true,
      username: true,
      metadata: true,
    },
  });
}

function verifiedSessionFromMetadata(metadata: unknown) {
  const record =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : {};
  const session =
    record.whatsappSession && typeof record.whatsappSession === 'object'
      ? (record.whatsappSession as Record<string, unknown>)
      : null;
  const verifiedAt = asString(session?.verifiedAt);
  const verifiedExpiresAt = asString(session?.verifiedExpiresAt);
  const verified =
    Boolean(verifiedAt) &&
    Boolean(verifiedExpiresAt) &&
    Date.parse(verifiedExpiresAt!) > Date.now();
  return {
    level: verified ? 'verified' : 'remembered',
    verified,
    verifiedAt,
    verifiedExpiresAt,
    purpose: asString(session?.purpose),
  };
}

async function resolveTrustedWhatsappIdentity(body: SupportToolBody, tenantId: string) {
  const bsuid = trustedBusinessScopedUserIdFromContext(body);
  const phone = trustedWhatsappPhoneFromContext(body);
  if (!bsuid && !phone) return null;
  return prisma.channelIdentity.findFirst({
    where: {
      tenantId,
      kind: 'whatsapp',
      OR: [
        ...(bsuid ? [{ businessScopedUserId: bsuid }] : []),
        ...(phone ? [{ externalUserId: phone }, { businessScopedUserId: phone }] : []),
      ],
    },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      tenantId: true,
      userId: true,
      externalUserId: true,
      businessScopedUserId: true,
      username: true,
      metadata: true,
    },
  });
}

async function requireVerifiedWhatsappSession(body: SupportToolBody, tenantId: string) {
  const signedContext = verifiedSupportContext(body);
  if (signedContext?.tenantId === tenantId) {
    return { ok: true as const, level: 'signed_dashboard_context' as const };
  }

  const identity = await resolveTrustedWhatsappIdentity(body, tenantId);
  if (!identity) {
    return {
      ok: false as const,
      error: 'verified_whatsapp_session_required',
      message:
        'This tool needs a verified WhatsApp session. Ask the user to complete the Sendero WhatsApp OTP check before showing booking, wallet, billing, escrow, or traveler profile details.',
    };
  }
  const session = verifiedSessionFromMetadata(identity.metadata);
  if (!session.verified) {
    return {
      ok: false as const,
      error: 'verified_whatsapp_session_required',
      identityId: identity.id,
      session,
      message:
        'This remembered WhatsApp session can collect intake and status, but sensitive details require OTP verification.',
    };
  }
  return { ok: true as const, identity, session };
}

async function getWhatsappSessionContext(body: SupportToolBody) {
  const { tenant, error } = await requireResolvedTenant(body);
  if (!tenant) return error;
  const identity = await resolveOrCreateWhatsappIdentity(body, tenant.id);
  if (!identity) return { ok: false, error: 'whatsapp_identity_required' };
  const user = identity.userId
    ? await prisma.user.findUnique({
        where: { id: identity.userId },
        select: { id: true, email: true, displayName: true, phone: true, mscaAddress: true },
      })
    : null;
  const session = verifiedSessionFromMetadata(identity.metadata);
  return {
    ok: true,
    tenant: { id: tenant.id, slug: tenant.slug },
    identity: {
      id: identity.id,
      userId: identity.userId,
      externalUserId: maskIdentifier(identity.externalUserId),
      businessScopedUserId: maskIdentifier(identity.businessScopedUserId),
      username: identity.username,
    },
    user,
    session,
    privileges: {
      remembered: [
        'itinerary questions',
        'trip gallery',
        'support status',
        'quote intake',
        'non-sensitive preferences',
      ],
      verified: [
        'ticket-delivery email confirmation',
        'booking detail display',
        'wallet address display',
        'traveler profile updates',
      ],
      privilegedAction:
        'payments, refunds, escrow settlement, wallet transfers, passport vault access, and policy overrides require an action-scoped web/passkey approval link.',
    },
  };
}

async function requestWhatsappOtp(body: SupportToolBody) {
  const { tenant, error } = await requireResolvedTenant(body);
  if (!tenant) return error;
  const identity = await resolveOrCreateWhatsappIdentity(body, tenant.id);
  if (!identity) return { ok: false, error: 'whatsapp_identity_required' };
  const recipient = identity.externalUserId ?? supportContext(body).whatsappPhoneNumber;
  if (!recipient) return { ok: false, error: 'whatsapp_phone_required' };

  const recent = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT count(*)::bigint AS count
    FROM whatsapp_session_verifications
    WHERE "tenantId" = ${tenant.id}
      AND "channelIdentityId" = ${identity.id}
      AND "createdAt" > now() - interval '10 minutes'
  `;
  if ((recent[0]?.count ?? 0n) >= 3n) {
    return { ok: false, error: 'otp_rate_limited' };
  }

  const purpose = asString(body.input?.purpose) ?? 'session_verify';
  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
  const nonce = crypto.randomBytes(16).toString('hex');
  const codeHash = hashOtp({
    tenantId: tenant.id,
    channelIdentityId: identity.id,
    nonce,
    code,
    purpose,
  });
  const expiresAt = new Date(Date.now() + 10 * 60_000);
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO whatsapp_session_verifications (
      id, "tenantId", "channelIdentityId", purpose, status, nonce, "codeHash",
      "expiresAt", metadata, "createdAt", "updatedAt"
    )
    VALUES (
      ${crypto.randomUUID()}, ${tenant.id}, ${identity.id}, ${purpose}, 'pending', ${nonce},
      ${codeHash}, ${expiresAt}, ${
        {
          requestedBy: 'kapso_whatsapp_tool',
          phoneNumberId: phoneNumberIdFromContext(body),
          workflowExecutionId: supportContext(body).workflowExecutionId,
        } as Prisma.InputJsonValue
      }, now(), now()
    )
    RETURNING id
  `;
  const verificationId = rows[0]?.id;

  const install = await prisma.whatsAppInstall.findUnique({
    where: { tenantId: tenant.id },
    select: { phoneNumberId: true },
  });
  if (!install?.phoneNumberId) return { ok: false, error: 'tenant_whatsapp_not_configured' };

  const apiKey = process.env.KAPSO_API_KEY;
  if (!apiKey) return { ok: false, error: 'kapso_api_key_missing' };

  const kapso = new KapsoClient({ apiKey, baseUrl: process.env.KAPSO_API_BASE_URL });
  const tpl = SENDERO_TEMPLATES.OTP_RESEND;
  try {
    const sent = await kapso.sendTemplate({
      phone_number_id: install.phoneNumberId,
      to: recipient.replace(/[^\d+]/g, ''),
      template_name: tpl.name,
      language_code: tpl.defaultLocale,
      components: buildOtpComponents(code),
    });
    await prisma.$executeRaw`
      UPDATE whatsapp_session_verifications
      SET status = 'pending', "sentAt" = now(), "providerMessageId" = ${sent.id}, "updatedAt" = now()
      WHERE id = ${verificationId}
    `;
    return {
      ok: true,
      verificationId,
      expiresAt,
      delivery: { channel: 'whatsapp', providerMessageId: sent.id },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.$executeRaw`
      UPDATE whatsapp_session_verifications
      SET status = 'failed', "failureReason" = ${safeText(message, 500)}, "updatedAt" = now()
      WHERE id = ${verificationId}
    `;
    return { ok: false, error: 'otp_send_failed', verificationId, message };
  }
}

async function verifyWhatsappOtp(body: SupportToolBody) {
  const { tenant, error } = await requireResolvedTenant(body);
  if (!tenant) return error;
  const identity = await resolveOrCreateWhatsappIdentity(body, tenant.id);
  if (!identity) return { ok: false, error: 'whatsapp_identity_required' };
  const code = asString(body.input?.code)?.replace(/\s+/g, '');
  if (!code || !/^\d{6}$/.test(code)) return { ok: false, error: 'valid_otp_required' };
  const verificationId =
    asString(body.input?.verification_id) ?? asString(body.input?.verificationId);
  const purpose = asString(body.input?.purpose) ?? 'session_verify';

  const rows = verificationId
    ? await prisma.$queryRaw<
        Array<{
          id: string;
          purpose: string;
          nonce: string;
          codeHash: string;
          expiresAt: Date;
          attemptCount: number;
          maxAttempts: number;
          status: string;
        }>
      >`
        SELECT id, purpose, nonce, "codeHash", "expiresAt", "attemptCount", "maxAttempts", status
        FROM whatsapp_session_verifications
        WHERE id = ${verificationId}
          AND "tenantId" = ${tenant.id}
          AND "channelIdentityId" = ${identity.id}
        LIMIT 1
      `
    : await prisma.$queryRaw<
        Array<{
          id: string;
          purpose: string;
          nonce: string;
          codeHash: string;
          expiresAt: Date;
          attemptCount: number;
          maxAttempts: number;
          status: string;
        }>
      >`
        SELECT id, purpose, nonce, "codeHash", "expiresAt", "attemptCount", "maxAttempts", status
        FROM whatsapp_session_verifications
        WHERE "tenantId" = ${tenant.id}
          AND "channelIdentityId" = ${identity.id}
          AND purpose = ${purpose}
          AND status = 'pending'
        ORDER BY "createdAt" DESC
        LIMIT 1
      `;
  const challenge = rows[0];
  if (!challenge) return { ok: false, error: 'otp_challenge_not_found' };
  if (challenge.status !== 'pending') return { ok: false, error: `otp_${challenge.status}` };

  const candidateHash = hashOtp({
    tenantId: tenant.id,
    channelIdentityId: identity.id,
    nonce: challenge.nonce,
    code,
    purpose: challenge.purpose,
  });
  if (!constantTimeEqual(candidateHash, challenge.codeHash)) {
    const invalidUpdates = await prisma.$executeRaw`
      UPDATE whatsapp_session_verifications
      SET "attemptCount" = "attemptCount" + 1,
          status = CASE WHEN "attemptCount" + 1 >= "maxAttempts" THEN 'failed' ELSE status END,
          "failureReason" = CASE WHEN "attemptCount" + 1 >= "maxAttempts" THEN 'max_attempts' ELSE "failureReason" END,
          "updatedAt" = now()
      WHERE id = ${challenge.id}
        AND status = 'pending'
        AND "attemptCount" < "maxAttempts"
        AND "expiresAt" > now()
    `;
    return invalidUpdates === 1
      ? { ok: false, error: 'otp_invalid' }
      : { ok: false, error: 'otp_challenge_not_available' };
  }

  const verifiedAt = new Date();
  const verifiedExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60_000);
  const verifiedUpdates = await prisma.$executeRaw`
    UPDATE whatsapp_session_verifications
    SET status = 'verified', "verifiedAt" = ${verifiedAt}, "attemptCount" = "attemptCount" + 1, "updatedAt" = now()
    WHERE id = ${challenge.id}
      AND status = 'pending'
      AND "attemptCount" < "maxAttempts"
      AND "expiresAt" > now()
      AND "codeHash" = ${candidateHash}
  `;
  if (verifiedUpdates !== 1) {
    return { ok: false, error: 'otp_challenge_not_available' };
  }
  const metadata =
    identity.metadata && typeof identity.metadata === 'object' && !Array.isArray(identity.metadata)
      ? (identity.metadata as Record<string, unknown>)
      : {};
  await prisma.channelIdentity.update({
    where: { id: identity.id },
    data: {
      metadata: {
        ...metadata,
        whatsappSession: {
          level: 'verified',
          purpose: challenge.purpose,
          verifiedAt: verifiedAt.toISOString(),
          verifiedExpiresAt: verifiedExpiresAt.toISOString(),
          verificationId: challenge.id,
        },
      } as Prisma.InputJsonValue,
    },
  });
  return {
    ok: true,
    verificationId: challenge.id,
    session: {
      level: 'verified',
      verifiedAt,
      verifiedExpiresAt,
      purpose: challenge.purpose,
    },
  };
}

async function createTenantHandoff(body: SupportToolBody) {
  const { tenant, error } = await requireResolvedTenant(body);
  if (!tenant) return error;
  const input = body.input ?? {};
  const context = supportContext(body);
  const id = crypto.randomUUID();
  const title = asString(input.title) ?? 'Traveler handoff';
  const summary = asString(input.summary) ?? asString(input.question) ?? title;
  const priority = asString(input.priority) === 'urgent' ? 'urgent' : 'normal';
  const rawContext = sanitizedSupportContext(body);
  const slackInstall = await prisma.slackInstall.findFirst({
    where: { tenantId: tenant.id, revokedAt: null },
    orderBy: { installedAt: 'desc' },
    select: { teamId: true, teamName: true, routing: true },
  });
  const handoffContext = {
    ...rawContext,
    kind: 'tenant_travel_handoff',
    primaryChannel: 'web_internal',
    optionalFanout: {
      slackConfigured: Boolean(slackInstall),
      slackTeamId: slackInstall?.teamId ?? null,
      whatsappOperatorConfigured: Boolean(asString(input.operator_whatsapp_phone)),
    },
    tripId: asString(input.trip_id) ?? asString(input.tripId),
  } as Prisma.InputJsonObject;

  await prisma.$executeRaw`
    INSERT INTO support_tickets (
      id, tenant_id, status, priority, source, title, summary,
      assignee_name, assignee_email, assignee_slack_user_id,
      whatsapp_conversation_id, whatsapp_phone_number, whatsapp_profile_name,
      workflow_execution_id, slack_channel_id, slack_message_ts, raw_context,
      created_at, updated_at
    )
    VALUES (
      ${id}, ${tenant.id}, 'open', ${priority}, 'web_internal',
      ${title}, ${summary}, ${asString(input.assignee_name)}, ${asString(input.assignee_email)},
      ${asString(input.assignee_slack_user_id)}, ${context.whatsappConversationId}, ${context.whatsappPhoneNumber},
      ${context.whatsappProfileName}, ${context.workflowExecutionId}, ${asString(input.slack_channel_id)},
      ${asString(input.slack_message_ts)}, ${handoffContext as Prisma.InputJsonValue}, now(), now()
    )
  `;
  await prisma.supportTurn.create({
    data: {
      tenantId: tenant.id,
      tripId: asString(input.trip_id) ?? asString(input.tripId) ?? undefined,
      turnSummary: summary,
      outcome: 'escalated',
      rawIo: { handoffId: id, ...handoffContext } as Prisma.InputJsonValue,
    },
  });
  return {
    ok: true,
    handoff: await getSupportTicket(id),
    primaryChannel: 'web_internal',
    fanout: {
      slackConfigured: Boolean(slackInstall),
      whatsappOperatorConfigured: Boolean(asString(input.operator_whatsapp_phone)),
    },
  };
}

async function getWalletContext(body: SupportToolBody) {
  const { tenant, error } = await requireResolvedTenant(body);
  if (!tenant) return error;
  const verified = await requireVerifiedWhatsappSession(body, tenant.id);
  if (!verified.ok) return verified;
  const input = body.input ?? {};
  const userId = asString(input.user_id) ?? asString(input.userId);
  const [tenantWallets, userWallets, gatewayConfig, signer] = await Promise.all([
    prisma.circleWallet.findMany({
      where: { tenantId: tenant.id },
      orderBy: { updatedAt: 'desc' },
      take: 10,
    }),
    userId
      ? prisma.wallet.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' }, take: 10 })
      : Promise.resolve([]),
    prisma.tenantGatewayConfig.findUnique({ where: { tenantId: tenant.id } }).catch(() => null),
    prisma.tenantGatewaySigner.findUnique({ where: { tenantId: tenant.id } }).catch(() => null),
  ]);
  return {
    ok: true,
    tenant: { id: tenant.id, slug: tenant.slug, arcAddress: tenant.arcAddress },
    sandbox: isFreeTenant(tenant),
    tenantWallets,
    userWallets,
    gateway: gatewayConfig
      ? { configured: true, updatedAt: gatewayConfig.updatedAt }
      : { configured: false },
    signer: signer ? { configured: true, updatedAt: signer.updatedAt } : { configured: false },
  };
}

async function getWhatsappSetupStatus(body: SupportToolBody) {
  const { tenant, error } = await requireResolvedTenant(body);
  if (!tenant) return error;
  const [install, apiLogs, webhookEvents, outbound] = await Promise.all([
    prisma.whatsAppInstall.findUnique({ where: { tenantId: tenant.id } }),
    prisma.whatsAppApiLog.findMany({
      where: { tenantId: tenant.id },
      orderBy: { calledAt: 'desc' },
      take: 10,
      select: {
        id: true,
        calledAt: true,
        target: true,
        method: true,
        endpoint: true,
        statusCode: true,
        durationMs: true,
        ok: true,
        errorMessage: true,
        traceId: true,
      },
    }),
    prisma.whatsAppWebhookEvent.findMany({
      where: { tenantId: tenant.id },
      orderBy: { receivedAt: 'desc' },
      take: 10,
      select: {
        id: true,
        receivedAt: true,
        signatureValid: true,
        replayWindowOk: true,
        messageCount: true,
        statusUpdateCount: true,
        identityChangeCount: true,
        droppedReplayCount: true,
        droppedDuplicateCount: true,
        dispatchedCount: true,
        durationMs: true,
        traceId: true,
      },
    }),
    prisma.whatsAppOutboundMessage.findMany({
      where: { tenantId: tenant.id },
      orderBy: { sentAt: 'desc' },
      take: 10,
      select: {
        id: true,
        phoneNumberId: true,
        recipientId: true,
        kind: true,
        source: true,
        templateName: true,
        preview: true,
        sentAt: true,
        deliveryStatus: true,
        failureReason: true,
        traceId: true,
      },
    }),
  ]);

  const setupLink = readSetupLinkSnapshot(install?.metadata);
  return {
    ok: true,
    tenant: { id: tenant.id, slug: tenant.slug, displayName: tenant.displayName },
    install: install
      ? {
          status: install.status,
          phoneNumberId: install.phoneNumberId,
          businessAccountId: install.businessAccountId,
          displayPhoneNumber: install.displayPhoneNumber,
          businessDisplayName: install.businessDisplayName,
          kapsoCustomerId: install.kapsoCustomerId,
          kapsoConnectionId: install.kapsoConnectionId,
          lastHealthyAt: install.lastHealthyAt,
          lastErrorMessage: install.lastErrorMessage,
          setupLink: setupLink
            ? {
                id: setupLink.id,
                status: setupLink.status,
                expiresAt: setupLink.expires_at,
                provisionPhoneNumber: setupLink.provision_phone_number,
                error: setupLink.whatsapp_setup_error,
              }
            : null,
        }
      : null,
    diagnostics: {
      recentApiLogs: apiLogs,
      recentWebhookEvents: webhookEvents,
      recentOutboundMessages: outbound.map(message => ({
        ...message,
        recipientId: maskIdentifier(message.recipientId),
      })),
    },
  };
}

async function getRecentChannelEvents(body: SupportToolBody) {
  const { tenant, error } = await requireResolvedTenant(body);
  if (!tenant) return error;
  const limit = asNumber(body.input?.limit, 20);
  const [webhooks, apiLogs, outbound, identities] = await Promise.all([
    prisma.whatsAppWebhookEvent.findMany({
      where: { tenantId: tenant.id },
      orderBy: { receivedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        receivedAt: true,
        signatureValid: true,
        replayWindowOk: true,
        messageCount: true,
        statusUpdateCount: true,
        identityChangeCount: true,
        droppedReplayCount: true,
        droppedDuplicateCount: true,
        dispatchedCount: true,
        durationMs: true,
        traceId: true,
      },
    }),
    prisma.whatsAppApiLog.findMany({
      where: { tenantId: tenant.id },
      orderBy: { calledAt: 'desc' },
      take: limit,
      select: {
        id: true,
        calledAt: true,
        target: true,
        method: true,
        endpoint: true,
        statusCode: true,
        durationMs: true,
        ok: true,
        errorMessage: true,
        traceId: true,
      },
    }),
    prisma.whatsAppOutboundMessage.findMany({
      where: { tenantId: tenant.id },
      orderBy: { sentAt: 'desc' },
      take: limit,
      select: {
        id: true,
        phoneNumberId: true,
        recipientId: true,
        kind: true,
        source: true,
        templateName: true,
        preview: true,
        sentAt: true,
        deliveryStatus: true,
        failureReason: true,
        traceId: true,
      },
    }),
    prisma.channelIdentity.findMany({
      where: { tenantId: tenant.id, kind: 'whatsapp' },
      orderBy: { updatedAt: 'desc' },
      take: Math.min(limit, 10),
      select: {
        id: true,
        externalUserId: true,
        businessScopedUserId: true,
        username: true,
        updatedAt: true,
      },
    }),
  ]);
  return {
    ok: true,
    tenant: { id: tenant.id, slug: tenant.slug },
    webhooks,
    apiLogs,
    outbound: outbound.map(message => ({
      ...message,
      recipientId: maskIdentifier(message.recipientId),
    })),
    identities: identities.map(identity => ({
      ...identity,
      externalUserId: maskIdentifier(identity.externalUserId),
      businessScopedUserId: maskIdentifier(identity.businessScopedUserId),
    })),
  };
}

async function getTripContext(body: SupportToolBody) {
  const { tenant, error } = await requireResolvedTenant(body);
  if (!tenant) return error;
  const verified = await requireVerifiedWhatsappSession(body, tenant.id);
  if (!verified.ok) return verified;
  const input = body.input ?? {};
  const tripId = asString(input.trip_id) ?? asString(input.tripId) ?? asString(input.id);
  const phone = asString(input.customer_phone_number) ?? asString(input.phone_number);
  const listAll = asBoolean(input.list_all) || asString(input.mode) === 'list';

  if (listAll || (!tripId && !phone)) {
    const trips = await prisma.trip.findMany({
      where: { tenantId: tenant.id },
      orderBy: { updatedAt: 'desc' },
      take: asNumber(input.limit, 10),
      select: {
        id: true,
        status: true,
        intent: true,
        totalUsdc: true,
        metadata: true,
        createdAt: true,
        updatedAt: true,
        traveler: { select: { id: true, email: true, displayName: true, phone: true } },
        createdBy: { select: { id: true, email: true, displayName: true } },
        bookings: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true,
            kind: true,
            status: true,
            externalId: true,
            pnr: true,
            totalUsd: true,
            costMicroUsdc: true,
            createdAt: true,
          },
        },
        settlements: {
          orderBy: { createdAt: 'desc' },
          take: 3,
          select: { id: true, status: true, grossMicroUsdc: true, createdAt: true },
        },
      },
    });
    return {
      ok: true,
      tenant: { id: tenant.id, slug: tenant.slug },
      mode: 'list',
      count: trips.length,
      trips,
    };
  }

  const trip = await prisma.trip.findFirst({
    where: {
      tenantId: tenant.id,
      ...(tripId
        ? { id: tripId }
        : phone
          ? { guestVerifiedContacts: { path: ['phone'], equals: phone } as Prisma.JsonFilter }
          : {}),
    },
    orderBy: { updatedAt: 'desc' },
    include: {
      traveler: {
        select: { id: true, email: true, displayName: true, phone: true },
      },
      createdBy: { select: { id: true, email: true, displayName: true } },
      policy: { select: { id: true, slug: true, displayName: true, version: true, rules: true } },
      bookings: { orderBy: { createdAt: 'desc' }, take: 10 },
      settlements: { orderBy: { createdAt: 'desc' }, take: 10 },
      sessions: { orderBy: { updatedAt: 'desc' }, take: 5 },
    },
  });
  if (!trip) return { ok: false, error: 'trip_not_found' };
  return { ok: true, tenant: { id: tenant.id, slug: tenant.slug }, trip };
}

async function getBillingContext(body: SupportToolBody) {
  const { tenant, error } = await requireResolvedTenant(body);
  if (!tenant) return error;
  const verified = await requireVerifiedWhatsappSession(body, tenant.id);
  if (!verified.ok) return verified;
  const [subscription, meterEvents, invoices, spendCaps] = await Promise.all([
    prisma.subscription.findUnique({ where: { tenantId: tenant.id } }),
    prisma.meterEvent.findMany({
      where: { tenantId: tenant.id },
      orderBy: { at: 'desc' },
      take: 20,
    }),
    prisma.invoice.findMany({
      where: { tenantId: tenant.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        number: true,
        kind: true,
        status: true,
        totalMicro: true,
        currency: true,
        issuedAt: true,
        dueAt: true,
        paidAt: true,
        createdAt: true,
      },
    }),
    prisma.tenantSpendCap.findMany({
      where: { tenantId: tenant.id },
      orderBy: { createdAt: 'desc' },
    }),
  ]);
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthlySpendMicroUsdc = meterEvents
    .filter(event => event.status === 'paid' && event.at >= monthStart)
    .reduce((sum, event) => sum + BigInt(event.priceMicroUsdc), 0n);
  return {
    ok: true,
    tenant: { id: tenant.id, slug: tenant.slug, billingTier: tenant.billingTier },
    billingPeriod: {
      monthStart,
      monthlySpendMicroUsdc,
      monthlySpendUsdc: (Number(monthlySpendMicroUsdc) / 1_000_000).toFixed(6),
    },
    subscription,
    meterEvents,
    invoices,
    spendCaps,
  };
}

async function getEscrowContext(body: SupportToolBody) {
  const { tenant, error } = await requireResolvedTenant(body);
  if (!tenant) return error;
  const verified = await requireVerifiedWhatsappSession(body, tenant.id);
  if (!verified.ok) return verified;
  const input = body.input ?? {};
  const tripId = asString(input.trip_id) ?? asString(input.tripId);
  const bookingId = asString(input.booking_id) ?? asString(input.bookingId);
  const [settlements, transferAttempts, wallets, deposits, transfers, validations] =
    await Promise.all([
      prisma.settlement.findMany({
        where: {
          tenantId: tenant.id,
          ...(tripId ? { tripId } : {}),
          ...(bookingId ? { bookingId } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      prisma.transferAttempt.findMany({
        where: {
          tenantId: tenant.id,
          ...(bookingId ? { metadata: { path: ['bookingId'], equals: bookingId } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      prisma.circleWallet.findMany({
        where: { tenantId: tenant.id },
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.gatewayDepositLog.findMany({
        where: { tenantId: tenant.id },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      prisma.gatewayTransferLog.findMany({
        where: { tenantId: tenant.id },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      prisma.validationCheck.findMany({
        where: { subject: { tenantId: tenant.id } },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);
  return {
    ok: true,
    tenant: { id: tenant.id, slug: tenant.slug, arcAddress: tenant.arcAddress },
    settlements,
    transferAttempts,
    wallets,
    gatewayDeposits: deposits,
    gatewayTransfers: transfers,
    validationChecks: validations,
  };
}

async function createSupportTicket(body: SupportToolBody) {
  const { tenant, error } = await requireResolvedTenant(body);
  if (!tenant) return error;
  const input = body.input ?? {};
  const context = supportContext(body);
  const id = crypto.randomUUID();
  const title = asString(input.title) ?? 'Sendero support escalation';
  const summary = asString(input.summary) ?? asString(input.question) ?? title;
  const priority = asString(input.priority) === 'urgent' ? 'urgent' : 'normal';
  const rawContext = sanitizedSupportContext(body);

  await prisma.$executeRaw`
    INSERT INTO support_tickets (
      id, tenant_id, status, priority, source, title, summary,
      assignee_name, assignee_email, assignee_slack_user_id,
      whatsapp_conversation_id, whatsapp_phone_number, whatsapp_profile_name,
      workflow_execution_id, slack_channel_id, slack_message_ts, raw_context,
      created_at, updated_at
    )
    VALUES (
      ${id}, ${tenant.id}, ${asString(input.status) ?? 'open'}, ${priority}, ${asString(input.source) ?? 'whatsapp'},
      ${title}, ${summary}, ${asString(input.assignee_name)}, ${asString(input.assignee_email)},
      ${asString(input.assignee_slack_user_id)}, ${context.whatsappConversationId}, ${context.whatsappPhoneNumber},
      ${context.whatsappProfileName}, ${context.workflowExecutionId}, ${asString(input.slack_channel_id)},
      ${asString(input.slack_message_ts)}, ${rawContext as Prisma.InputJsonValue}, now(), now()
    )
  `;
  await prisma.supportTurn.create({
    data: {
      tenantId: tenant.id,
      turnSummary: summary,
      outcome: 'escalated',
      rawIo: { supportTicketId: id, ...rawContext } as Prisma.InputJsonValue,
    },
  });
  return { ok: true, ticket: await getSupportTicket(id) };
}

async function updateSupportTicket(body: SupportToolBody) {
  const input = body.input ?? {};
  const ticketId = asString(input.ticket_id) ?? asString(input.ticketId);
  if (!ticketId) return { ok: false, error: 'ticket_id_required' };
  const existing = await getSupportTicket(ticketId);
  const ticketTenantId = asString(existing?.tenant_id);
  if (!ticketTenantId) return { ok: false, error: 'ticket_not_found' };
  const { tenant, error } = await requireResolvedTenant(body);
  if (!tenant && error?.error === 'tenant_not_found') {
    // Slack resume calls are authenticated by the support-tools secret and ticket id.
    // They may not have the original signed dashboard token, so scope the update to the
    // existing ticket tenant instead of failing a legitimate human escalation close.
  } else if (!tenant && error) {
    return error;
  }
  if (tenant && ticketTenantId && tenant.id !== ticketTenantId) {
    return { ok: false, error: 'ticket_tenant_mismatch' };
  }
  const tenantId = tenant?.id ?? ticketTenantId;
  const status = asString(input.status);
  const summary = asString(input.summary);
  await prisma.$executeRaw`
    UPDATE support_tickets
    SET
      status = COALESCE(${status}, status),
      summary = COALESCE(${summary}, summary),
      closed_at = CASE WHEN ${status} IN ('closed', 'resolved') THEN now() ELSE closed_at END,
      updated_at = now()
    WHERE id = ${ticketId} AND tenant_id = ${tenantId}
  `;
  return { ok: true, ticket: await getSupportTicket(ticketId) };
}

async function getSupportTicket(id: string) {
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT * FROM support_tickets WHERE id = ${id} LIMIT 1
  `;
  return rows[0] ?? null;
}

async function listSupportTickets(tenantId: string, limit: number) {
  return prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT id, status, priority, title, summary, assignee_name, assignee_email,
           assignee_slack_user_id, slack_channel_id, slack_message_ts, created_at, updated_at
    FROM support_tickets
    WHERE tenant_id = ${tenantId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `.catch(() => []);
}

async function searchSenderoDocs(body: SupportToolBody) {
  const query = asString(body.input?.query);
  if (!query) return { ok: false, error: 'query_required' };
  const limit = asNumber(body.input?.limit, 8);
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const sources = [
    'https://docs.sendero.travel/llms.txt',
    'https://docs.sendero.travel/docs/quickstart',
    'https://docs.sendero.travel/docs/mcp-integration',
    'https://docs.sendero.travel/docs/agent-to-agent-booking',
    'https://docs.sendero.travel/docs/security',
    'https://docs.sendero.travel/docs/x402-nanopayments',
    'https://docs.sendero.travel/docs/pricing',
    'https://docs.sendero.travel/docs/tools/overview',
  ];
  const matches: Array<{ url: string; title: string; score: number; excerpt: string }> = [];
  for (const url of sources) {
    const response = await fetch(url).catch(() => null);
    const text = response?.ok ? await response.text() : '';
    const lower = text.toLowerCase();
    const score = terms.reduce((sum, term) => sum + (lower.includes(term) ? 1 : 0), 0);
    if (!score) continue;
    const firstTerm = terms.find(term => lower.includes(term));
    const index = firstTerm ? lower.indexOf(firstTerm) : 0;
    matches.push({
      url,
      title: titleFromText(text, url),
      score,
      excerpt: text
        .slice(Math.max(0, index - 180), index + 420)
        .replace(/\s+/g, ' ')
        .trim(),
    });
  }
  matches.sort((a, b) => b.score - a.score || a.url.localeCompare(b.url));
  return { ok: true, query, results: matches.slice(0, limit) };
}

function titleFromText(text: string, url: string): string {
  const heading = text.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading || new URL(url).pathname.split('/').filter(Boolean).pop() || url;
}

function lifecycleTitle(operation: SupportTool, input: Record<string, unknown>): string {
  const explicit = asString(input.title);
  if (explicit) return explicit;
  const label = operation.replace(/_/g, ' ');
  const tripId = asString(input.trip_id) ?? asString(input.tripId);
  const subject =
    asString(input.quote_id) ??
    asString(input.booking_id) ??
    asString(input.reference) ??
    asString(input.destination) ??
    asString(input.city) ??
    tripId;
  return subject ? `${label}: ${subject}` : label;
}

async function createLifecycleHandoff(operation: SupportTool, body: SupportToolBody) {
  const input = body.input ?? {};
  return createTenantHandoff({
    ...body,
    input: {
      ...input,
      title: lifecycleTitle(operation, input),
      summary:
        asString(input.summary) ??
        [
          `Tool: ${operation}`,
          asString(input.trip_id) || asString(input.tripId)
            ? `Trip ID: ${asString(input.trip_id) ?? asString(input.tripId)}`
            : null,
          asString(input.reference) ? `Reference: ${asString(input.reference)}` : null,
          asString(input.details) ? `Details: ${asString(input.details)}` : null,
          'Risk policy: WhatsApp can collect intent; payment, refunds, escrow settlement, booking commits, wallet movement, and NFT unlocks require secure approval or human review.',
        ]
          .filter(Boolean)
          .join('\n'),
    },
  });
}

async function getLifecycleReadContext(operation: SupportTool, body: SupportToolBody) {
  if (
    operation === 'get_booking_context' ||
    operation === 'get_disruption_context' ||
    operation === 'get_trip_gallery' ||
    operation === 'get_nft_stamp_status'
  ) {
    const tripContext = await getTripContext(body);
    return {
      ok: true,
      tool: operation,
      riskPolicy:
        operation === 'get_nft_stamp_status'
          ? 'Viewing status is allowed; unlock or mint actions require verified identity or secure approval.'
          : 'Read-only context may be returned to the user after tenant/session resolution.',
      context: tripContext,
    };
  }
  if (operation === 'get_prefund_claim_status') {
    const tripContext = await getTripContext(body);
    return {
      ok: true,
      tool: operation,
      policy:
        'Prefunded links are claimable only with a secure code sent to ticket email. Do not ask for the code in WhatsApp.',
      context: tripContext,
    };
  }
  return {
    ok: true,
    tool: operation,
    message:
      'Search-only lifecycle tool is not connected to a supplier API yet. Create a handoff/request before quoting or booking.',
  };
}

const OPERATIONS: Record<SupportTool, (body: SupportToolBody) => Promise<unknown>> = {
  create_accommodation_request: body =>
    createLifecycleHandoff('create_accommodation_request', body),
  create_ancillary_request: body => createLifecycleHandoff('create_ancillary_request', body),
  create_disruption_handoff: body => createLifecycleHandoff('create_disruption_handoff', body),
  create_prefunded_trip_link: body => createLifecycleHandoff('create_prefunded_trip_link', body),
  create_quote_request: body => createLifecycleHandoff('create_quote_request', body),
  create_tenant_handoff: createTenantHandoff,
  create_trip_intake: createTripIntake,
  create_whatsapp_login_signup: createWhatsappLoginSignup,
  create_support_ticket: createSupportTicket,
  create_transfer_request: body => createLifecycleHandoff('create_transfer_request', body),
  get_billing_context: getBillingContext,
  get_booking_context: body => getLifecycleReadContext('get_booking_context', body),
  get_disruption_context: body => getLifecycleReadContext('get_disruption_context', body),
  get_escrow_context: getEscrowContext,
  get_nft_stamp_status: body => getLifecycleReadContext('get_nft_stamp_status', body),
  get_prefund_claim_status: body => getLifecycleReadContext('get_prefund_claim_status', body),
  get_recent_channel_events: getRecentChannelEvents,
  get_tenant_operating_context: getTenantOperatingContext,
  get_tenant_context: getTenantContext,
  get_tenant_whatsapp_flow: getTenantWhatsAppFlow,
  get_trip_gallery: body => getLifecycleReadContext('get_trip_gallery', body),
  get_trip_context: getTripContext,
  get_wallet_context: getWalletContext,
  get_whatsapp_session_context: getWhatsappSessionContext,
  get_whatsapp_setup_status: getWhatsappSetupStatus,
  list_quote_options: body => getLifecycleReadContext('list_quote_options', body),
  request_whatsapp_otp: requestWhatsappOtp,
  request_booking_change: body => createLifecycleHandoff('request_booking_change', body),
  request_nft_unlock: body => createLifecycleHandoff('request_nft_unlock', body),
  request_payment_link: body => createLifecycleHandoff('request_payment_link', body),
  request_quote_approval: body => createLifecycleHandoff('request_quote_approval', body),
  search_accommodation: body => getLifecycleReadContext('search_accommodation', body),
  search_car_rentals: body => getLifecycleReadContext('search_car_rentals', body),
  search_restaurants: body => getLifecycleReadContext('search_restaurants', body),
  search_sendero_docs: searchSenderoDocs,
  update_support_ticket: updateSupportTicket,
  upsert_tenant_whatsapp_flow: upsertTenantWhatsAppFlow,
  verify_whatsapp_otp: verifyWhatsappOtp,
};

export async function POST(request: Request): Promise<Response> {
  const startedAt = Date.now();
  const secret = configuredSecret();
  if (!secret) {
    return NextResponse.json({ error: 'support_tools_not_configured' }, { status: 503 });
  }
  if (request.headers.get('x-sendero-support-secret') !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = (await request.json()) as SupportToolBody;
  const operation = body.operation;
  if (!operation || !(operation in OPERATIONS)) {
    return NextResponse.json({ error: 'unknown_operation', operation }, { status: 400 });
  }

  const parentTraceId =
    extractTraceId(request.headers) ??
    asString(body.input?.trace_id) ??
    asString(body.input?.traceId) ??
    asString(body.execution_context?.system?.trace_id) ??
    asString(body.execution_context?.system?.traceId) ??
    asString(body.execution_context?.system?.flow_execution_id) ??
    asString(body.execution_context?.system?.workflow_execution_id) ??
    undefined;
  const context = supportContext(body);
  const tenantHint =
    asString(body.input?.tenant_id) ??
    asString(body.input?.tenantId) ??
    verifiedSupportContext(body)?.tenantId ??
    'kapso-support-tools';

  const traced = await traceAgent(
    'sendero-whatsapp-support-tools',
    {
      tenantId: tenantHint,
      userId: context.whatsappPhoneNumber ?? undefined,
      sessionId: context.whatsappConversationId ?? parentTraceId,
      model: 'kapso-worker-tool',
      trigger: 'webhook',
      surface: 'whatsapp',
      channel: 'kapso',
      turnId: context.workflowExecutionId ?? parentTraceId,
      parentTraceId,
      toolCallCount: 1,
    },
    async ({ traceId }) => {
      const result = await OPERATIONS[operation](body);
      return { result, traceId };
    }
  );

  const traceId = traced.traceId;
  const ok =
    traced.result.result &&
    typeof traced.result.result === 'object' &&
    !Array.isArray(traced.result.result) &&
    'ok' in traced.result.result
      ? traced.result.result.ok !== false
      : true;

  scoreToolSuccess(traceId, [{ toolName: operation, success: ok }]).catch(() => {});
  scoreLatency(traceId, Date.now() - startedAt).catch(() => {});
  flushLangfuse().catch(() => {});

  return new Response(
    JSON.stringify(withTrace(traced.result.result, traceId), (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    ),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'x-sendero-trace-id': traceId,
      },
    }
  );
}
