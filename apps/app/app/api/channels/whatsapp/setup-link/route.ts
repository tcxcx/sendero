/**
 * POST /api/channels/whatsapp/setup-link
 *
 * Admin-only. Starts (or re-starts) the Kapso BYO WhatsApp onboarding
 * flow: creates the Kapso customer keyed on tenantId, mints a setup
 * link, persists a `WhatsAppInstall` row in `pending` state, and
 * returns the hosted onboarding URL for the admin to complete.
 *
 * The actual `active` state is written by the Kapso webhook when
 * `whatsapp.phone_number.created` fires.
 *
 * Ported from desk-v1 (no direct analogue — BUFI used a static wa.me
 * link), designed fresh from the integrate-whatsapp skill setup-link
 * primitive.
 */

import { NextResponse } from 'next/server';

import { auth } from '@clerk/nextjs/server';
import { type Prisma, prisma } from '@sendero/database';
import { env } from '@sendero/env';
import {
  isSetupLinkExpired,
  KapsoClient,
  readSetupLinkSnapshot,
  setupLinkSnapshot,
  startOnboarding,
} from '@sendero/kapso';

import { requireCurrentTenant } from '@/lib/tenant-context';
import { isMetaMockPhoneNumber, META_MOCK_PHONE_NUMBER_MESSAGE } from '@/lib/whatsapp-mock-number';

import crypto from 'node:crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(): Promise<Response> {
  const apiKey = env.kapsoApiKey();
  if (!apiKey) {
    return NextResponse.json(
      { error: 'kapso_not_configured', message: 'KAPSO_API_KEY unset' },
      { status: 503 }
    );
  }

  const { tenant, userId } = await requireCurrentTenant();
  const { has } = await auth();
  if (!has({ role: 'org:admin' })) {
    console.warn('[whatsapp/setup-link] forbidden', {
      tenantId: tenant.id,
      userId,
    });
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const webhookBase = env.kapsoWebhookBaseUrl();
  if (!webhookBase) {
    return NextResponse.json(
      {
        error: 'kapso_not_configured',
        message: 'KAPSO_WEBHOOK_BASE_URL / NEXT_PUBLIC_APP_URL unset',
      },
      { status: 503 }
    );
  }
  const redirectUrl = `${webhookBase.replace(/\/$/, '')}/dashboard/channels/whatsapp/connect?onboarding=whatsapp&status=connected`;
  const failureRedirectUrl = `${webhookBase.replace(/\/$/, '')}/dashboard/channels/whatsapp/connect?onboarding=whatsapp&status=failed`;

  const kapso = new KapsoClient({ apiKey, baseUrl: env.kapsoApiBaseUrl() });
  console.info('[whatsapp/setup-link] request', {
    tenantId: tenant.id,
    tenantName: tenant.displayName,
    userId,
    redirectUrl,
    failureRedirectUrl,
  });

  // Reuse the existing Kapso customer when present + setup link still valid.
  const existing = await prisma.whatsAppInstall.findUnique({
    where: { tenantId: tenant.id },
    select: {
      id: true,
      kapsoCustomerId: true,
      metadata: true,
      displayPhoneNumber: true,
      phoneNumberId: true,
      status: true,
    },
  });

  if (existing) {
    const hasMockPhoneNumber = isMetaMockPhoneNumber(existing.displayPhoneNumber);
    const rawLink = readSetupLinkSnapshot(existing.metadata);
    const linkError = rawLink?.whatsapp_setup_error ?? null;
    const linkStatus = rawLink?.whatsapp_setup_status ?? rawLink?.status ?? null;
    if (
      !hasMockPhoneNumber &&
      rawLink &&
      !linkError &&
      !isSetupLinkExpired({ expires_at: rawLink.expires_at })
    ) {
      console.info('[whatsapp/setup-link] reusing existing setup link', {
        tenantId: tenant.id,
        installId: existing.id,
        customerId: existing.kapsoCustomerId,
        installStatus: existing.status,
        linkStatus,
      });
      return NextResponse.json({
        customerId: existing.kapsoCustomerId,
        setupLink: rawLink,
        status: existing.status,
        reused: true,
      });
    }

    // Re-issue link against the same customer.
    console.info('[whatsapp/setup-link] creating fresh setup link', {
      tenantId: tenant.id,
      installId: existing.id,
      customerId: existing.kapsoCustomerId,
      installStatus: existing.status,
      hadMockPhoneNumber: hasMockPhoneNumber,
      priorLinkStatus: linkStatus,
      priorLinkError: linkError,
      priorLinkExpired: rawLink ? isSetupLinkExpired({ expires_at: rawLink.expires_at }) : null,
    });
    let freshLink: Awaited<ReturnType<KapsoClient['createSetupLink']>>;
    try {
      freshLink = await kapso.createSetupLink(existing.kapsoCustomerId, {
        success_redirect_url: redirectUrl,
        failure_redirect_url: failureRedirectUrl,
        allowed_connection_types: ['coexistence', 'dedicated'],
        provision_phone_number: false,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[whatsapp/setup-link] Kapso createSetupLink failed', {
        tenantId: tenant.id,
        installId: existing.id,
        customerId: existing.kapsoCustomerId,
        error: message,
      });
      return NextResponse.json({ error: 'kapso_setup_link_failed', message }, { status: 502 });
    }
    const freshSnapshot = setupLinkSnapshot(freshLink);
    await prisma.whatsAppInstall.update({
      where: { id: existing.id },
      data: {
        status: hasMockPhoneNumber
          ? 'pending'
          : existing.status === 'active'
            ? 'active'
            : 'pending',
        phoneNumberId: hasMockPhoneNumber ? null : undefined,
        kapsoConnectionId: hasMockPhoneNumber ? null : undefined,
        displayPhoneNumber: hasMockPhoneNumber ? null : undefined,
        businessDisplayName: hasMockPhoneNumber ? null : undefined,
        lastErrorMessage: null,
        metadata: {
          setupLink: freshSnapshot,
          ...(hasMockPhoneNumber
            ? {
                metaMockPhoneNumberRestartedAt: new Date().toISOString(),
                metaMockPhoneNumber: existing.displayPhoneNumber,
                metaMockPhoneNumberId: existing.phoneNumberId,
                metaMockPhoneNumberReason: META_MOCK_PHONE_NUMBER_MESSAGE,
              }
            : {}),
        } as unknown as Prisma.InputJsonValue,
      },
    });
    console.info('[whatsapp/setup-link] fresh setup link stored', {
      tenantId: tenant.id,
      installId: existing.id,
      customerId: existing.kapsoCustomerId,
      installStatus: hasMockPhoneNumber
        ? 'pending'
        : existing.status === 'active'
          ? 'active'
          : 'pending',
      setupLinkId: freshSnapshot.id,
      setupLinkStatus: freshSnapshot.status ?? null,
    });
    return NextResponse.json({
      customerId: existing.kapsoCustomerId,
      setupLink: freshSnapshot,
      status: hasMockPhoneNumber ? 'pending' : existing.status === 'active' ? 'active' : 'pending',
      reused: true,
      restartedAfterMockPhoneNumber: hasMockPhoneNumber,
    });
  }

  let onboarding: Awaited<ReturnType<typeof startOnboarding>>;
  try {
    onboarding = await startOnboarding(kapso, {
      tenantId: tenant.id,
      tenantName: tenant.displayName,
      redirectUrl,
      failureRedirectUrl,
      countryIsos: tenant.fiscalCountry ? [tenant.fiscalCountry] : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[whatsapp/setup-link] Kapso startOnboarding failed', {
      tenantId: tenant.id,
      tenantName: tenant.displayName,
      error: message,
    });
    return NextResponse.json({ error: 'kapso_onboarding_failed', message }, { status: 502 });
  }
  const { customer, setupLink } = onboarding;
  const setupLinkData = setupLinkSnapshot(setupLink);

  // Mint a per-install webhook secret ahead of the Kapso webhook. Kapso
  // issues its own secret when we register the phone-number webhook
  // after `phone_number.created` fires; we keep this one as the
  // *project-scope* verifier.
  const projectWebhookSecret = crypto.randomBytes(32).toString('hex');

  await prisma.whatsAppInstall.create({
    data: {
      tenantId: tenant.id,
      kapsoCustomerId: customer.id,
      webhookSecret: projectWebhookSecret,
      status: 'pending',
      connectedByUserId: userId,
      metadata: { setupLink: setupLinkData } as unknown as Prisma.InputJsonValue,
    },
  });
  console.info('[whatsapp/setup-link] install created', {
    tenantId: tenant.id,
    customerId: customer.id,
    setupLinkId: setupLinkData.id,
    status: 'pending',
  });

  return NextResponse.json({
    customerId: customer.id,
    setupLink: setupLinkData,
    status: 'pending',
    reused: false,
  });
}
