/**
 * POST /api/channels/slack/installs/[installId]/disconnect
 *
 * Disconnects a Slack install from the tenant. Two side-effects:
 *
 *   1. `auth.revoke` is called against Slack with the bot token. Slack
 *      uninstalls the app from the workspace; users see "Sendero" leave
 *      the App directory page. Token is invalidated immediately.
 *   2. The `SlackInstall` row is deleted so our routing/cap pipelines
 *      stop trying to post to a workspace that's hung up on us.
 *
 * Stage 1 deletes the row outright. Stage 2 will add a `disconnectedAt`
 * soft-delete column so we keep the audit trail of past installs and
 * can resurrect routing config on reinstall. For v1 the operator
 * reinstalls fresh via the public install URL or the wizard.
 *
 * Auth: Clerk session, scoped to the tenant that owns the install.
 * Cross-tenant disconnect attempts get 404 (intentional — never
 * confirm or deny existence of another tenant's install).
 */

import { type NextRequest, NextResponse } from 'next/server';

import { auth } from '@clerk/nextjs/server';
import { prisma } from '@sendero/database';
import { createSlackClient } from '@sendero/slack';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ installId: string }>;
}

export async function POST(_req: NextRequest, ctx: RouteParams) {
  const { installId } = await ctx.params;

  const session = await auth();
  if (!session.orgId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const tenant = await prisma.tenant.findUnique({
    where: { clerkOrgId: session.orgId },
    select: { id: true },
  });
  if (!tenant) {
    return NextResponse.json({ error: 'tenant_not_found' }, { status: 404 });
  }

  const install = await prisma.slackInstall.findFirst({
    where: { id: installId, tenantId: tenant.id },
    select: { id: true, botToken: true, teamName: true },
  });
  if (!install) {
    return NextResponse.json({ error: 'install_not_found' }, { status: 404 });
  }

  // Revoke the bot token on Slack side. If this fails (network blip,
  // Slack outage, token already revoked from the Slack admin UI), we
  // still delete our row — the tenant's intent is "stop using this
  // install", and a stale row would block reinstall via the unique
  // constraint on (enterpriseId, teamId). Best-effort.
  try {
    const client = createSlackClient(install.botToken);
    await client.auth.revoke({ test: false });
  } catch (err) {
    console.warn('[slack/disconnect] auth.revoke failed (non-fatal)', {
      installId,
      teamName: install.teamName,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  await prisma.slackInstall.delete({ where: { id: install.id } });

  return NextResponse.json({ ok: true, installId, teamName: install.teamName });
}
