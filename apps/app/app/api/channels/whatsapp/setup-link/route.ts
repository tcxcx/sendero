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

type WhatsAppNumberSource = 'existing' | 'kapso_provisioned';

interface SetupLinkRequestBody {
  numberSource?: WhatsAppNumberSource;
  provisionPhoneNumber?: boolean;
  countryIso?: string;
}

export async function POST(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const queryProvision = parseBooleanQuery(searchParams.get('provision'));
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
  const setupAttemptId = crypto.randomUUID();
  const body = await readSetupLinkRequestBody(request);
  if (queryProvision !== undefined) {
    body.provisionPhoneNumber = queryProvision;
    body.numberSource = queryProvision ? 'kapso_provisioned' : 'existing';
  }
  console.info('[whatsapp/setup-link] request', {
    tenantId: tenant.id,
    tenantName: tenant.displayName,
    userId,
    setupAttemptId,
    numberSource: body.numberSource ?? null,
    provisionPhoneNumber: body.provisionPhoneNumber ?? null,
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
    if (isSandboxInstall(existing.metadata)) {
      return NextResponse.json({
        customerId: existing.kapsoCustomerId,
        setupLink: null,
        status: existing.status,
        numberSource: 'kapso_provisioned',
        provisionPhoneNumber: true,
        reused: true,
        sandbox: true,
      });
    }
    const hasMockPhoneNumber = isMetaMockPhoneNumber(existing.displayPhoneNumber);
    const rawLink = readSetupLinkSnapshot(existing.metadata);
    const setupMode = resolveSetupMode(existing.metadata, body, tenant.fiscalCountry ?? undefined);
    const linkError = rawLink?.whatsapp_setup_error ?? null;
    const linkStatus = rawLink?.whatsapp_setup_status ?? rawLink?.status ?? null;
    if (
      !hasMockPhoneNumber &&
      rawLink &&
      !linkError &&
      !isSetupLinkExpired({ expires_at: rawLink.expires_at }) &&
      rawLink.provision_phone_number === setupMode.provisionPhoneNumber
    ) {
      console.info('[whatsapp/setup-link] reusing existing setup link', {
        tenantId: tenant.id,
        installId: existing.id,
        customerId: existing.kapsoCustomerId,
        installStatus: existing.status,
        linkStatus,
        numberSource: setupMode.numberSource,
        provisionPhoneNumber: setupMode.provisionPhoneNumber,
      });
      return NextResponse.json({
        customerId: existing.kapsoCustomerId,
        setupLink: rawLink,
        status: existing.status,
        numberSource: setupMode.numberSource,
        provisionPhoneNumber: setupMode.provisionPhoneNumber,
        reused: true,
      });
    }

    if (hasMockPhoneNumber) {
      let onboarding: Awaited<ReturnType<typeof startOnboarding>>;
      try {
        onboarding = await startOnboarding(kapso, {
          tenantId: tenant.id,
          customerExternalId: `${tenant.id}:whatsapp:${setupAttemptId}`,
          tenantName: tenant.displayName,
          redirectUrl,
          failureRedirectUrl,
          countryIsos: [setupMode.countryIso],
          provisionPhoneNumber: setupMode.provisionPhoneNumber,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[whatsapp/setup-link] Kapso restart onboarding failed', {
          tenantId: tenant.id,
          installId: existing.id,
          error: message,
        });
        return NextResponse.json({ error: 'kapso_onboarding_failed', message }, { status: 502 });
      }

      const freshSnapshot = setupLinkSnapshot(onboarding.setupLink);
      await prisma.whatsAppInstall.update({
        where: { id: existing.id },
        data: {
          kapsoCustomerId: onboarding.customer.id,
          status: 'pending',
          phoneNumberId: null,
          kapsoConnectionId: null,
          displayPhoneNumber: null,
          businessDisplayName: null,
          lastErrorMessage: null,
          metadata: {
            setupLink: freshSnapshot,
            setupAttemptId,
            customerExternalId: `${tenant.id}:whatsapp:${setupAttemptId}`,
            numberSource: setupMode.numberSource,
            provisionPhoneNumber: setupMode.provisionPhoneNumber,
            countryIso: setupMode.countryIso,
            metaMockPhoneNumberRestartedAt: new Date().toISOString(),
            metaMockPhoneNumber: existing.displayPhoneNumber,
            metaMockPhoneNumberId: existing.phoneNumberId,
            metaMockPhoneNumberReason: META_MOCK_PHONE_NUMBER_MESSAGE,
          } as unknown as Prisma.InputJsonValue,
        },
      });
      console.info('[whatsapp/setup-link] restarted setup after Meta mock number', {
        tenantId: tenant.id,
        installId: existing.id,
        previousCustomerId: existing.kapsoCustomerId,
        customerId: onboarding.customer.id,
        setupAttemptId,
        setupLinkId: freshSnapshot.id,
      });
      return NextResponse.json({
        customerId: onboarding.customer.id,
        setupLink: freshSnapshot,
        status: 'pending',
        numberSource: setupMode.numberSource,
        provisionPhoneNumber: setupMode.provisionPhoneNumber,
        reused: false,
        restartedAfterMockPhoneNumber: true,
      });
    }

    // Re-issue link against the same customer.
    console.info('[whatsapp/setup-link] creating fresh setup link', {
      tenantId: tenant.id,
      installId: existing.id,
      customerId: existing.kapsoCustomerId,
      installStatus: existing.status,
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
        provision_phone_number: setupMode.provisionPhoneNumber,
        phone_number_country_isos: [setupMode.countryIso],
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
        status: existing.status === 'active' ? 'active' : 'pending',
        lastErrorMessage: null,
        metadata: mergeJsonObject(existing.metadata, {
          setupLink: freshSnapshot,
          numberSource: setupMode.numberSource,
          provisionPhoneNumber: setupMode.provisionPhoneNumber,
          countryIso: setupMode.countryIso,
        }),
      },
    });
    console.info('[whatsapp/setup-link] fresh setup link stored', {
      tenantId: tenant.id,
      installId: existing.id,
      customerId: existing.kapsoCustomerId,
      installStatus: existing.status === 'active' ? 'active' : 'pending',
      setupLinkId: freshSnapshot.id,
      setupLinkStatus: freshSnapshot.status ?? null,
      numberSource: setupMode.numberSource,
      provisionPhoneNumber: setupMode.provisionPhoneNumber,
    });
    return NextResponse.json({
      customerId: existing.kapsoCustomerId,
      setupLink: freshSnapshot,
      status: existing.status === 'active' ? 'active' : 'pending',
      numberSource: setupMode.numberSource,
      provisionPhoneNumber: setupMode.provisionPhoneNumber,
      reused: true,
    });
  }

  const setupMode = resolveSetupMode(null, body, tenant.fiscalCountry ?? undefined);
  let onboarding: Awaited<ReturnType<typeof startOnboarding>>;
  try {
    onboarding = await startOnboarding(kapso, {
      tenantId: tenant.id,
      tenantName: tenant.displayName,
      redirectUrl,
      failureRedirectUrl,
      countryIsos: [setupMode.countryIso],
      provisionPhoneNumber: setupMode.provisionPhoneNumber,
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
      metadata: {
        setupLink: setupLinkData,
        setupAttemptId,
        customerExternalId: tenant.id,
        numberSource: setupMode.numberSource,
        provisionPhoneNumber: setupMode.provisionPhoneNumber,
        countryIso: setupMode.countryIso,
      } as unknown as Prisma.InputJsonValue,
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
    numberSource: setupMode.numberSource,
    provisionPhoneNumber: setupMode.provisionPhoneNumber,
    reused: false,
  });
}

async function readSetupLinkRequestBody(request: Request): Promise<SetupLinkRequestBody> {
  try {
    const raw = (await request.json()) as unknown;
    if (!raw || typeof raw !== 'object') return {};
    const record = raw as Record<string, unknown>;
    const numberSource =
      record.numberSource === 'kapso_provisioned' || record.numberSource === 'existing'
        ? record.numberSource
        : undefined;
    return {
      numberSource,
      provisionPhoneNumber:
        typeof record.provisionPhoneNumber === 'boolean' ? record.provisionPhoneNumber : undefined,
      countryIso:
        typeof record.countryIso === 'string' && /^[a-z]{2}$/i.test(record.countryIso)
          ? record.countryIso.toUpperCase()
          : undefined,
    };
  } catch {
    return {};
  }
}

function resolveSetupMode(
  metadata: Prisma.JsonValue | null,
  body: SetupLinkRequestBody,
  fallbackCountryIso = 'US'
): { numberSource: WhatsAppNumberSource; provisionPhoneNumber: boolean; countryIso: string } {
  const record =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : {};
  const storedSource =
    record.numberSource === 'kapso_provisioned' || record.numberSource === 'existing'
      ? record.numberSource
      : undefined;
  const requestedKapsoProvision = body.numberSource
    ? body.numberSource === 'kapso_provisioned'
    : undefined;
  const storedKapsoProvision =
    typeof record.provisionPhoneNumber === 'boolean' ? record.provisionPhoneNumber : undefined;
  const storedSourceKapsoProvision = storedSource === 'kapso_provisioned';
  const provisionPhoneNumber =
    body.provisionPhoneNumber ??
    requestedKapsoProvision ??
    storedKapsoProvision ??
    storedSourceKapsoProvision;
  const numberSource: WhatsAppNumberSource = provisionPhoneNumber
    ? 'kapso_provisioned'
    : 'existing';
  const countryIso =
    body.countryIso ??
    (typeof record.countryIso === 'string' && /^[a-z]{2}$/i.test(record.countryIso)
      ? record.countryIso.toUpperCase()
      : fallbackCountryIso.toUpperCase());

  return { numberSource, provisionPhoneNumber, countryIso };
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

function parseBooleanQuery(value: string | null): boolean | undefined {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}
