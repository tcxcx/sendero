/**
 * Per-channel connect/disconnect endpoints.
 *
 *   POST   — bot joins the channel (`conversations.join`) AND ensures a
 *            routing rule exists with mode 'route' (was: silent or absent).
 *   DELETE — bot leaves the channel (`conversations.leave`) AND removes
 *            the channel from `SlackInstall.routing.routes[]`.
 *
 * Why both Slack-side membership AND routing JSON in one call: the two
 * have to stay in sync or the panel UI lies. If the bot leaves the
 * channel but routing still says "post here", the next event hits
 * not_in_channel. If routing says silent but the bot is still a member,
 * we look paranoid and noisy on Slack's side.
 *
 * Auth: Clerk session + tenant ownership of the install. Cross-tenant
 * attempts return 404 to avoid leaking existence.
 */

import { type NextRequest, NextResponse } from 'next/server';

import { auth } from '@clerk/nextjs/server';
import { prisma } from '@sendero/database';
import { createSlackClient } from '@sendero/slack';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ installId: string; channelId: string }>;
}

interface SlackRouting {
  defaultChannel?: string;
  routes?: Array<{ eventClass: string; channelId: string; mode: string }>;
}

async function loadInstall(installId: string) {
  const session = await auth();
  if (!session.orgId) return { error: 'unauthorized', status: 401 } as const;
  const tenant = await prisma.tenant.findUnique({
    where: { clerkOrgId: session.orgId },
    select: { id: true },
  });
  if (!tenant) return { error: 'tenant_not_found', status: 404 } as const;
  const install = await prisma.slackInstall.findFirst({
    where: { id: installId, tenantId: tenant.id },
    select: { id: true, botToken: true, routing: true, teamName: true },
  });
  if (!install) return { error: 'install_not_found', status: 404 } as const;
  return { install, tenantId: tenant.id } as const;
}

/** Bot joins the channel + ensures routing rule. */
export async function POST(_req: NextRequest, ctx: RouteParams) {
  const { installId, channelId } = await ctx.params;
  const result = await loadInstall(installId);
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { install } = result;

  let joined = false;
  try {
    const client = createSlackClient(install.botToken);
    const res = await client.conversations.join({ channel: channelId });
    const warning = (res as { warning?: string }).warning;
    joined = warning !== 'already_in_channel';
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('method_not_supported_for_channel_type') || msg.includes('is_private')) {
      return NextResponse.json(
        {
          error: 'private_channel',
          message:
            "Slack doesn't let bots join private channels. Run `/invite @Sendero` from inside the channel instead.",
        },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: 'join_failed', message: msg }, { status: 502 });
  }

  // Ensure a routing rule exists for this channel. If the channel was
  // already routed (just disconnected via mode=silent earlier), flip it
  // back to 'route'. Otherwise add a default trip-events route — the
  // operator can re-tune mode in the wizard.
  const routing = (install.routing as unknown as SlackRouting | null) ?? {};
  const routes = routing.routes ?? [];
  const existing = routes.find(r => r.channelId === channelId);
  if (existing) {
    existing.mode = 'route';
  } else {
    routes.push({ eventClass: 'trip_events', channelId, mode: 'route' });
  }
  const nextRouting: SlackRouting = { ...routing, routes };
  await prisma.slackInstall.update({
    where: { id: install.id },
    data: { routing: nextRouting as unknown as object },
  });

  return NextResponse.json({ ok: true, joined, channelId });
}

/** Bot leaves the channel + removes routing rule. */
export async function DELETE(_req: NextRequest, ctx: RouteParams) {
  const { installId, channelId } = await ctx.params;
  const result = await loadInstall(installId);
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { install } = result;

  // Slack-side leave first. If it fails because the bot wasn't a
  // member, that's fine — proceed to clean up routing anyway.
  try {
    const client = createSlackClient(install.botToken);
    await client.conversations.leave({ channel: channelId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes('not_in_channel') && !msg.includes('channel_not_found')) {
      console.warn('[slack/channel-leave] non-fatal failure', {
        installId,
        channelId,
        error: msg,
      });
    }
  }

  // Remove the channel from routing. If it was the default channel,
  // null that out — the operator must pick a new default in the wizard
  // before the next event class can route there.
  const routing = (install.routing as unknown as SlackRouting | null) ?? {};
  const nextRouting: SlackRouting = {
    ...routing,
    defaultChannel: routing.defaultChannel === channelId ? undefined : routing.defaultChannel,
    routes: (routing.routes ?? []).filter(r => r.channelId !== channelId),
  };
  await prisma.slackInstall.update({
    where: { id: install.id },
    data: { routing: nextRouting as unknown as object },
  });

  return NextResponse.json({ ok: true, channelId });
}
