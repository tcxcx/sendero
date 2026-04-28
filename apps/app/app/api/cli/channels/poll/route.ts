/**
 * GET /api/cli/channels/poll?tenantId=<>&channel=slack|whatsapp
 *
 * Used by `sendero channels connect <channel>` to wait for an external
 * install to land. CLI hits this every 2s (5-min timeout) until
 * `installed: true` flips.
 *
 * Auth: Bearer API key. The key MUST resolve to the requested tenantId
 * — otherwise an attacker with one tenant's key could enumerate the
 * install state of every other tenant by walking tenantId values.
 *
 * Returns:
 *   { installed: boolean, teamName?: string, installedAt?: string }
 *
 * Sister endpoint to `/api/cli/channels/status` which returns ALL
 * channels for a tenant in one shot (used by `channels status`).
 */

import { type NextRequest, NextResponse } from 'next/server';

import { prisma } from '@sendero/database';

import { resolveTenantFromApiKey } from '@/lib/api-key-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SUPPORTED_CHANNELS = ['slack', 'whatsapp'] as const;
type Channel = (typeof SUPPORTED_CHANNELS)[number];

export async function GET(req: NextRequest): Promise<Response> {
  const resolved = await resolveTenantFromApiKey(req);
  if (!resolved) {
    return NextResponse.json(
      { error: 'invalid_or_missing_api_key' },
      { status: 401, headers: { 'cache-control': 'no-store' } }
    );
  }

  const url = req.nextUrl;
  const tenantId = url.searchParams.get('tenantId');
  const channel = url.searchParams.get('channel') as Channel | null;

  if (!tenantId || !channel) {
    return NextResponse.json(
      { error: 'missing_params', need: ['tenantId', 'channel'] },
      { status: 400 }
    );
  }

  if (!SUPPORTED_CHANNELS.includes(channel)) {
    return NextResponse.json(
      { error: 'unsupported_channel', supported: SUPPORTED_CHANNELS },
      { status: 400 }
    );
  }

  // Tenant pin — the API key MUST own the tenant being polled. Without
  // this, any authenticated caller could probe other tenants' install
  // states by walking tenantIds.
  if (resolved.tenantId !== tenantId) {
    return NextResponse.json(
      { error: 'tenant_mismatch', message: 'API key does not belong to the requested tenant.' },
      { status: 403, headers: { 'cache-control': 'no-store' } }
    );
  }

  const status = await readChannelStatus(tenantId, channel);

  return NextResponse.json(status, {
    status: 200,
    headers: { 'cache-control': 'no-store' },
  });
}

async function readChannelStatus(
  tenantId: string,
  channel: Channel
): Promise<{ installed: boolean; teamName?: string; installedAt?: string }> {
  if (channel === 'slack') {
    const install = await prisma.slackInstall.findFirst({
      where: { tenantId, revokedAt: null },
      select: { teamName: true, installedAt: true },
      orderBy: { installedAt: 'desc' },
    });
    if (!install) return { installed: false };
    return {
      installed: true,
      teamName: install.teamName ?? undefined,
      installedAt: install.installedAt?.toISOString(),
    };
  }

  // WhatsApp — `status='active'` is the readiness gate; `pending` means
  // Kapso wizard accepted the customer but the WABA still needs Meta
  // approval, so we don't claim "installed" until status flips.
  const wa = await prisma.whatsAppInstall.findFirst({
    where: { tenantId, status: 'active' },
    select: { businessDisplayName: true, displayPhoneNumber: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
  if (!wa) return { installed: false };
  return {
    installed: true,
    teamName: wa.businessDisplayName ?? wa.displayPhoneNumber ?? undefined,
    installedAt: wa.createdAt?.toISOString(),
  };
}
