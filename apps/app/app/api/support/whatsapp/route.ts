import { NextResponse } from 'next/server';

import { type Prisma, prisma } from '@sendero/database';

import { currentOrgPlanTier } from '@/lib/billing-plan';
import { getRequestLocale } from '@/lib/request-locale';
import { requireCurrentTenant } from '@/lib/tenant-context';

import crypto from 'node:crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function supportMessageForDashboardTenant(args: {
  displayName: string;
  locale: string;
  supportRef: string;
}): string {
  return [
    'Hi Sendero support, I need help from my dashboard.',
    '',
    `Support ref: ${args.supportRef}`,
    `Locale: ${args.locale}`,
    '',
    'What I need help with:',
  ].join('\n');
}

async function createSupportSession(args: {
  billingTier: string;
  clerkOrgId: string;
  displayName: string;
  id: string;
  locale: string;
  plan: string;
  slug: string;
}): Promise<string> {
  const code = `SR-${crypto
    .randomBytes(5)
    .toString('base64url')
    .replace(/[^A-Z0-9]/gi, '')
    .toUpperCase()}`;
  const context = {
    billingTier: args.billingTier,
    clerkOrgId: args.clerkOrgId,
    displayName: args.displayName,
    locale: args.locale,
    plan: args.plan,
    tenantSlug: args.slug,
  };
  await prisma.$executeRaw`
    INSERT INTO support_context_sessions (code, tenant_id, context, expires_at)
    VALUES (${code}, ${args.id}, ${context as Prisma.InputJsonValue}, now() + interval '24 hours')
    ON CONFLICT (code) DO UPDATE
    SET tenant_id = EXCLUDED.tenant_id,
        context = EXCLUDED.context,
        expires_at = EXCLUDED.expires_at,
        last_used_at = null
  `;
  return code;
}

function configuredSupportUrl(message: string): string | null {
  const explicit =
    process.env.SENDERO_SUPPORT_WA_URL ??
    process.env.NEXT_PUBLIC_SENDERO_SUPPORT_WA_URL ??
    process.env.NEXT_PUBLIC_SENDERO_WA_URL ??
    '';
  const trimmed = cleanEnvValue(explicit);
  if (trimmed && !isBareWhatsAppUrl(trimmed)) {
    return withDefaultText(trimmed, message);
  }

  const number = (
    cleanEnvValue(process.env.SENDERO_SUPPORT_WA_NUMBER) ??
    cleanEnvValue(process.env.NEXT_PUBLIC_SENDERO_SUPPORT_WA_NUMBER) ??
    ''
  ).replace(/\D/g, '');
  if (!number) return null;
  return withDefaultText(`https://wa.me/${number}`, message);
}

function cleanEnvValue(value: string | undefined): string {
  return (value ?? '').replace(/\\n$/g, '').trim();
}

function isBareWhatsAppUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.hostname === 'wa.me' && url.pathname.replace(/\//g, '') === '';
  } catch {
    return false;
  }
}

function withDefaultText(rawUrl: string, message: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol)) return null;
  const host = url.hostname.toLowerCase();
  const supportsPrefill = host === 'wa.me' || host.endsWith('whatsapp.com');
  const currentText = url.searchParams.get('text')?.trim() ?? '';
  if (supportsPrefill && !currentText) {
    url.searchParams.set('text', message);
  }
  return url.toString();
}

export async function GET(request: Request): Promise<Response> {
  const [plan, locale, currentTenant] = await Promise.all([
    currentOrgPlanTier(),
    getRequestLocale(),
    requireCurrentTenant(),
  ]);
  const { tenant } = currentTenant;
  if (plan === 'free') {
    return NextResponse.redirect(
      new URL('/dashboard/billing/plans?upgrade=basic&feature=whatsapp-support', request.url)
    );
  }

  const supportRef = await createSupportSession({
    billingTier: tenant.billingTier,
    clerkOrgId: tenant.clerkOrgId,
    displayName: tenant.displayName,
    id: tenant.id,
    locale,
    plan,
    slug: tenant.slug,
  });

  const supportUrl = configuredSupportUrl(
    supportMessageForDashboardTenant({
      displayName: tenant.displayName,
      locale,
      supportRef,
    })
  );
  if (!supportUrl) {
    return NextResponse.json(
      {
        error: 'support_whatsapp_not_configured',
        message: 'Set SENDERO_SUPPORT_WA_URL or SENDERO_SUPPORT_WA_NUMBER.',
      },
      { status: 503, headers: { 'cache-control': 'no-store' } }
    );
  }

  return NextResponse.redirect(supportUrl);
}
