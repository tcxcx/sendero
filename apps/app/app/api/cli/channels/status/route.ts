/**
 * GET /api/cli/channels/status?tenantId=<>
 *
 * One-shot status of every channel for a tenant. Used by
 * `sendero channels status` (vs `poll` which is single-channel + retry).
 *
 * Auth + tenant pin: same as the poll endpoint — the API key MUST
 * own the requested tenant.
 */

import { type NextRequest, NextResponse } from 'next/server';

import { prisma } from '@sendero/database';

import { resolveTenantFromApiKey } from '@/lib/api-key-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ChannelState {
  installed: boolean;
  teamName?: string;
  installedAt?: string;
}

export async function GET(req: NextRequest): Promise<Response> {
  const resolved = await resolveTenantFromApiKey(req);
  if (!resolved) {
    return NextResponse.json(
      { error: 'invalid_or_missing_api_key' },
      { status: 401, headers: { 'cache-control': 'no-store' } }
    );
  }

  const tenantId = req.nextUrl.searchParams.get('tenantId');
  if (!tenantId) {
    return NextResponse.json({ error: 'missing_tenantId' }, { status: 400 });
  }

  if (resolved.tenantId !== tenantId) {
    return NextResponse.json(
      { error: 'tenant_mismatch' },
      { status: 403, headers: { 'cache-control': 'no-store' } }
    );
  }

  const [slack, whatsapp] = await Promise.all([
    prisma.slackInstall.findFirst({
      where: { tenantId, revokedAt: null },
      select: { teamName: true, installedAt: true },
      orderBy: { installedAt: 'desc' },
    }),
    prisma.whatsAppInstall.findFirst({
      where: { tenantId, status: 'active' },
      select: { businessDisplayName: true, displayPhoneNumber: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const slackState: ChannelState = slack
    ? { installed: true, teamName: slack.teamName ?? undefined, installedAt: slack.installedAt?.toISOString() }
    : { installed: false };

  const whatsappState: ChannelState = whatsapp
    ? {
        installed: true,
        teamName: whatsapp.businessDisplayName ?? whatsapp.displayPhoneNumber ?? undefined,
        installedAt: whatsapp.createdAt?.toISOString(),
      }
    : { installed: false };

  return NextResponse.json(
    { slack: slackState, whatsapp: whatsappState },
    { status: 200, headers: { 'cache-control': 'no-store' } }
  );
}
