/**
 * POST /api/channels/whatsapp/sandbox
 *
 * Local/dev helper for binding the provider sandbox WhatsApp number to
 * the active tenant. This lets us test inbound messages, automations,
 * tool routing, and outbound replies while Meta business verification is
 * blocked. Production onboarding still uses the hosted real-number flow.
 */

import { NextResponse } from 'next/server';

import { auth } from '@clerk/nextjs/server';
import { type Prisma, prisma } from '@sendero/database';
import { env } from '@sendero/env';
import { KapsoClient } from '@sendero/kapso';

import { requireCurrentTenant } from '@/lib/tenant-context';
import { ensureTenantWhatsAppFlows } from '@/lib/whatsapp-flow-registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  if (!isSandboxBindAllowed()) {
    return NextResponse.json({ error: 'sandbox_bind_unavailable' }, { status: 404 });
  }

  const { tenant, userId } = await requireCurrentTenant();
  const { has } = await auth();
  if (!has({ role: 'org:admin' })) {
    console.warn('[whatsapp/sandbox] forbidden', { tenantId: tenant.id, userId });
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const phoneNumberId = env.kapsoSandboxPhoneNumberId();
  const businessAccountId = env.kapsoSandboxBusinessAccountId();
  const configurationId = env.kapsoSandboxConfigurationId();
  const displayPhoneNumber = env.kapsoSandboxDisplayPhoneNumber();
  const kapsoCustomerId = `sandbox:${tenant.id}`;

  await prisma.whatsAppInstall
    .updateMany({
      where: {
        tenantId: { not: tenant.id },
        OR: [{ phoneNumberId }, { kapsoConnectionId: phoneNumberId }],
      },
      data: {
        status: 'disabled',
        phoneNumberId: null,
        kapsoConnectionId: null,
        lastErrorMessage: 'Sandbox WhatsApp number rebound to another dev workspace.',
      },
    })
    .catch(err => {
      console.warn('[whatsapp/sandbox] previous sandbox binding cleanup failed', {
        tenantId: tenant.id,
        phoneNumberId,
        error: err instanceof Error ? err.message : String(err),
      });
    });

  let tenantFlows: unknown = null;
  try {
    tenantFlows = await ensureTenantWhatsAppFlows({
      tenantId: tenant.id,
      tenantDisplayName: tenant.displayName,
      phoneNumberId,
      businessAccountId,
    });
  } catch (err) {
    tenantFlows = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      checkedAt: new Date().toISOString(),
    };
    console.warn('[whatsapp/sandbox] tenant flow registration failed', {
      tenantId: tenant.id,
      phoneNumberId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  const inboundWebhook = await ensureSandboxInboundWebhook(phoneNumberId);
  const metadata = {
    sandbox: true,
    source: 'provider_sandbox',
    configurationId,
    tenantFlows,
    inboundWebhook,
    boundAt: new Date().toISOString(),
  } as Prisma.InputJsonObject;

  const install = await prisma.whatsAppInstall.upsert({
    where: { tenantId: tenant.id },
    update: {
      kapsoCustomerId,
      kapsoConnectionId: phoneNumberId,
      phoneNumberId,
      businessAccountId,
      displayPhoneNumber,
      businessDisplayName: tenant.displayName,
      webhookSecret: env.kapsoGlobalWebhookSecret() ?? 'sandbox-dev-webhook-secret',
      status: 'active',
      lastErrorMessage: null,
      lastHealthyAt: new Date(),
      connectedByUserId: userId,
      metadata,
    },
    create: {
      tenantId: tenant.id,
      kapsoCustomerId,
      kapsoConnectionId: phoneNumberId,
      phoneNumberId,
      businessAccountId,
      displayPhoneNumber,
      businessDisplayName: tenant.displayName,
      webhookSecret: env.kapsoGlobalWebhookSecret() ?? 'sandbox-dev-webhook-secret',
      status: 'active',
      lastErrorMessage: null,
      lastHealthyAt: new Date(),
      connectedByUserId: userId,
      metadata,
    },
    select: {
      id: true,
      status: true,
      phoneNumberId: true,
      displayPhoneNumber: true,
      businessAccountId: true,
    },
  });

  console.info('[whatsapp/sandbox] bound sandbox number', {
    tenantId: tenant.id,
    installId: install.id,
    phoneNumberId,
    businessAccountId,
    configurationId,
  });

  return NextResponse.json({ ok: true, install, sandbox: true });
}

async function ensureSandboxInboundWebhook(
  phoneNumberId: string
): Promise<Record<string, unknown>> {
  const apiKey = env.kapsoApiKey();
  const secret = env.kapsoGlobalWebhookSecret();
  const baseUrl = env.kapsoWebhookBaseUrl();
  if (!apiKey || !secret || !baseUrl) {
    return {
      status: 'skipped',
      reason: !apiKey ? 'missing_api_key' : !secret ? 'missing_secret' : 'missing_webhook_url',
      checkedAt: new Date().toISOString(),
    };
  }
  const url = `${baseUrl.replace(/\/$/, '')}/api/webhooks/whatsapp`;
  if (url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1')) {
    return {
      status: 'skipped',
      reason: 'webhook_url_not_public',
      url,
      checkedAt: new Date().toISOString(),
    };
  }

  const client = new KapsoClient({ apiKey, baseUrl: env.kapsoApiBaseUrl() });
  const events = [
    'whatsapp.message.received',
    'whatsapp.message.delivered',
    'whatsapp.message.read',
    'whatsapp.message.failed',
  ];

  // Sandbox is shared across dev workspaces. Without dedup, every bind
  // appends another webhook and Kapso fans inbound events to all of
  // them — including stale URLs that 404, breaking observability on
  // the survivors. List + reconcile to keep one active registration
  // pointing at the current URL with the current secret.
  let removed = 0;
  try {
    const existing = await client.listPhoneNumberWebhooks(phoneNumberId);
    for (const wh of existing) {
      const sameUrl = wh.url === url;
      const sameSecret = (wh.secret_key ?? wh.secret) === secret;
      if (sameUrl && sameSecret && wh.active !== false) {
        return {
          status: 'active',
          id: wh.id,
          url: wh.url,
          events: wh.events,
          reused: true,
          checkedAt: new Date().toISOString(),
        };
      }
      try {
        await client.deletePhoneNumberWebhook(phoneNumberId, wh.id);
        removed++;
      } catch (err) {
        console.warn('[whatsapp/sandbox] stale webhook delete failed', {
          phoneNumberId,
          webhookId: wh.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } catch (err) {
    console.warn('[whatsapp/sandbox] webhook listing failed; will attempt fresh register', {
      phoneNumberId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    const webhook = await client.registerWebhook({
      scope: 'phone_number',
      phone_number_id: phoneNumberId,
      url,
      events,
      kind: 'kapso',
      payload_version: 'v2',
      active: true,
      secret_key: secret,
    });
    return {
      status: 'active',
      id: webhook.id,
      url: webhook.url,
      events: webhook.events,
      removedStale: removed,
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      status: 'error',
      url,
      error: err instanceof Error ? err.message : String(err),
      checkedAt: new Date().toISOString(),
    };
  }
}

function isSandboxBindAllowed(): boolean {
  if (process.env.NODE_ENV !== 'production') return true;
  return process.env.SENDERO_ENABLE_WHATSAPP_SANDBOX === 'true';
}
