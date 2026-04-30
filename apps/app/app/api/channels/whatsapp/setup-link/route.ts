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
import crypto from 'node:crypto';
import { NextResponse } from 'next/server';

import { requireCurrentTenant } from '@/lib/tenant-context';

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
  const redirectUrl = `${webhookBase.replace(/\/$/, '')}/dashboard/settings/channels?onboarding=whatsapp&status=connected`;
  const failureRedirectUrl = `${webhookBase.replace(/\/$/, '')}/dashboard/settings/channels?onboarding=whatsapp&status=failed`;

  const kapso = new KapsoClient({ apiKey, baseUrl: env.kapsoApiBaseUrl() });

  // Reuse the existing Kapso customer when present + setup link still valid.
  const existing = await prisma.whatsAppInstall.findUnique({
    where: { tenantId: tenant.id },
    select: {
      id: true,
      kapsoCustomerId: true,
      metadata: true,
      status: true,
    },
  });

  if (existing) {
    const rawLink = readSetupLinkSnapshot(existing.metadata);
    if (rawLink && !isSetupLinkExpired({ expires_at: rawLink.expires_at })) {
      return NextResponse.json({
        customerId: existing.kapsoCustomerId,
        setupLink: rawLink,
        status: existing.status,
        reused: true,
      });
    }

    // Re-issue link against the same customer.
    const freshLink = await kapso.createSetupLink(existing.kapsoCustomerId, {
      success_redirect_url: redirectUrl,
      failure_redirect_url: failureRedirectUrl,
      allowed_connection_types: ['coexistence', 'dedicated'],
      provision_phone_number: false,
    });
    const freshSnapshot = setupLinkSnapshot(freshLink);
    await prisma.whatsAppInstall.update({
      where: { id: existing.id },
      data: {
        status: existing.status === 'active' ? 'active' : 'pending',
        lastErrorMessage: null,
        metadata: { setupLink: freshSnapshot } as unknown as Prisma.InputJsonValue,
      },
    });
    return NextResponse.json({
      customerId: existing.kapsoCustomerId,
      setupLink: freshSnapshot,
      status: existing.status === 'active' ? 'active' : 'pending',
      reused: true,
    });
  }

  const { customer, setupLink } = await startOnboarding(kapso, {
    tenantId: tenant.id,
    tenantName: tenant.displayName,
    redirectUrl,
    failureRedirectUrl,
    countryIsos: tenant.fiscalCountry ? [tenant.fiscalCountry] : undefined,
  });
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

  return NextResponse.json({
    customerId: customer.id,
    setupLink: setupLinkData,
    status: 'pending',
    reused: false,
  });
}
