import { NextResponse } from 'next/server';

import { type Prisma, prisma } from '@sendero/database';
import { readSetupLinkSnapshot } from '@sendero/kapso';

import crypto from 'node:crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SupportTool =
  | 'get_tenant_operating_context'
  | 'create_trip_intake'
  | 'create_tenant_handoff'
  | 'get_wallet_context'
  | 'get_tenant_context'
  | 'get_whatsapp_setup_status'
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

function json(data: unknown, status = 200): Response {
  return new Response(
    JSON.stringify(data, (_key, value) => (typeof value === 'bigint' ? value.toString() : value)),
    {
      status,
      headers: { 'content-type': 'application/json' },
    }
  );
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
  const input = body.input ?? {};
  const phoneNumberId = phoneNumberIdFromContext(body);
  if (phoneNumberId) {
    const install = await prisma.whatsAppInstall.findUnique({
      where: { phoneNumberId },
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

  const phone =
    asString(input.phone_number) ??
    asString(input.customer_phone_number) ??
    asString(body.execution_context?.context?.phone_number) ??
    asString(body.whatsapp_context?.conversation?.phone_number);
  if (phone) {
    const identity = await prisma.channelIdentity.findFirst({
      where: {
        kind: 'whatsapp',
        OR: [{ externalUserId: phone }, { businessScopedUserId: phone }],
      },
      orderBy: { updatedAt: 'desc' },
      include: { tenant: true },
    });
    if (identity?.tenant) return identity.tenant;
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
    phoneNumberId: phoneNumberIdFromContext(body),
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

const OPERATIONS: Record<SupportTool, (body: SupportToolBody) => Promise<unknown>> = {
  create_tenant_handoff: createTenantHandoff,
  create_trip_intake: createTripIntake,
  create_support_ticket: createSupportTicket,
  get_billing_context: getBillingContext,
  get_escrow_context: getEscrowContext,
  get_recent_channel_events: getRecentChannelEvents,
  get_tenant_operating_context: getTenantOperatingContext,
  get_tenant_context: getTenantContext,
  get_trip_context: getTripContext,
  get_wallet_context: getWalletContext,
  get_whatsapp_setup_status: getWhatsappSetupStatus,
  search_sendero_docs: searchSenderoDocs,
  update_support_ticket: updateSupportTicket,
};

export async function POST(request: Request): Promise<Response> {
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
  return json(await OPERATIONS[operation](body));
}
