/**
 * Slack OAuth callback.
 *
 * Receives `code` + `state` after the user approves the install, swaps
 * for a bot token, and persists a SlackInstall row. Enterprise Grid is
 * fully supported — installs spanning multiple workspaces resolve to a
 * single (enterpriseId, teamId) record.
 *
 * State carries the Sendero tenantId (the Clerk org that initiated the
 * install). For Phase 2 the state is unsigned base64-JSON; harden with
 * an HMAC wrapper in Phase 3.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { env } from '@sendero/env';
import { prisma } from '@sendero/database';
import { exchangeCode } from '@sendero/slack';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const clientId = env.slackClientId();
  const clientSecret = env.slackClientSecret();
  const redirectUri = env.slackRedirectUri();

  if (!clientId || !clientSecret || !redirectUri) {
    return NextResponse.json(
      {
        error: 'slack_not_configured',
        message:
          'SLACK_CLIENT_ID + SLACK_CLIENT_SECRET + SLACK_REDIRECT_URI required for the install flow.',
      },
      { status: 503 }
    );
  }

  const { searchParams } = req.nextUrl;
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  if (!code || !state) {
    return NextResponse.json({ error: 'missing_params' }, { status: 400 });
  }

  let tenantId: string;
  try {
    const decoded = JSON.parse(Buffer.from(state, 'base64url').toString('utf-8')) as {
      tenantId?: string;
    };
    if (!decoded.tenantId) throw new Error('tenantId missing from state');
    tenantId = decoded.tenantId;
  } catch {
    return NextResponse.json({ error: 'invalid_state' }, { status: 400 });
  }

  const tenantExists = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true },
  });
  if (!tenantExists) {
    return NextResponse.json({ error: 'unknown_tenant' }, { status: 404 });
  }

  try {
    const install = await exchangeCode({
      clientId,
      clientSecret,
      redirectUri,
      code,
    });

    await prisma.slackInstall.upsert({
      where: {
        enterpriseId_teamId: {
          enterpriseId: install.enterpriseId ?? '',
          teamId: install.teamId,
        },
      },
      create: {
        tenantId,
        enterpriseId: install.enterpriseId,
        enterpriseName: install.enterpriseName,
        teamId: install.teamId,
        teamName: install.teamName,
        appId: install.appId,
        botUserId: install.botUserId,
        botToken: install.botToken,
        scope: install.scope,
        isEnterpriseInstall: install.isEnterpriseInstall,
        authedUserId: install.authedUserId,
        raw: install.raw as object,
      },
      update: {
        tenantId,
        botToken: install.botToken,
        scope: install.scope,
        enterpriseName: install.enterpriseName,
        teamName: install.teamName,
        isEnterpriseInstall: install.isEnterpriseInstall,
        raw: install.raw as object,
      },
    });

    return NextResponse.redirect(new URL('/dashboard/settings/slack?installed=1', req.url));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[slack/oauth] exchange failed:', msg);
    return NextResponse.json({ error: 'oauth_exchange_failed', message: msg }, { status: 500 });
  }
}
