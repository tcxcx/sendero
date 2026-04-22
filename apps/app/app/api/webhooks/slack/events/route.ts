/**
 * Slack Events API endpoint.
 *
 * Verifies HMAC + 5-min replay window, responds to `url_verification`
 * challenge, persists a ChannelIdentity on every user event, then
 * dispatches DMs + app-mentions to the shared /api/agent/dispatch
 * fan-in. Reply is posted back via chat.postMessage in the originating
 * thread (thread_ts preserved for proper threading).
 *
 * Slack requires a <3s ack; the agent dispatch fires-and-forgets and
 * we return 200 immediately to Slack.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { env } from '@sendero/env';
import { prisma } from '@sendero/database';
import { detectLocale } from '@sendero/locale';
import {
  createSlackClient,
  deriveTenantKey,
  isUrlVerificationChallenge,
  postMessage,
  verifySlackSignature,
  type SlackEvent,
  type SlackEventEnvelope,
} from '@sendero/slack';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 10;

export async function POST(req: NextRequest) {
  const signingSecret = env.slackSigningSecret();
  if (!signingSecret) {
    return NextResponse.json(
      { error: 'slack_not_configured', message: 'SLACK_SIGNING_SECRET unset' },
      { status: 503 }
    );
  }

  const rawBody = await req.text();
  const verify = verifySlackSignature(
    rawBody,
    {
      'x-slack-request-timestamp': req.headers.get('x-slack-request-timestamp'),
      'x-slack-signature': req.headers.get('x-slack-signature'),
    },
    { signingSecret }
  );
  if (verify.ok === false) {
    return NextResponse.json({ error: verify.reason }, { status: 401 });
  }

  let parsed: SlackEventEnvelope;
  try {
    parsed = JSON.parse(rawBody) as SlackEventEnvelope;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  // Slack subscription challenge (first-time setup).
  if (isUrlVerificationChallenge(parsed)) {
    return new NextResponse(parsed.challenge, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  // Resolve install → tenant
  const { enterpriseId, teamId } = deriveTenantKey(parsed);
  const install = await resolveInstall(enterpriseId, teamId);
  if (!install) {
    // Install uninstalled or unknown — ack so Slack doesn't retry forever.
    return NextResponse.json({ ok: true, unknown_install: true });
  }

  // Persist sender ChannelIdentity for downstream agent routing.
  const userId = parsed.event?.user;
  const locale = requestLocale(req);
  if (userId) {
    try {
      await prisma.channelIdentity.upsert({
        where: {
          tenantId_kind_externalUserId: {
            tenantId: install.tenantId,
            kind: 'slack',
            externalUserId: userId,
          },
        },
        create: {
          tenantId: install.tenantId,
          kind: 'slack',
          externalUserId: userId,
          metadata: { teamId, enterpriseId, locale, localeSource: 'request_headers' },
        },
        update: { metadata: { teamId, enterpriseId, locale, localeSource: 'request_headers' } },
      });
    } catch (err) {
      console.error('[slack/events] identity upsert failed:', err);
    }
  }

  // Dispatch DMs + app-mentions to /api/agent/dispatch. Fire-and-forget
  // so Slack gets its ack inside the 3s window. Ignore bot messages to
  // avoid infinite loops when the agent's own reply re-enters the
  // webhook.
  const ev = parsed.event;
  if (ev && shouldDispatchToAgent(ev) && userId && ev.text) {
    void dispatchAndReply({
      req,
      tenantId: install.tenantId,
      botToken: install.botToken,
      event: ev,
      eventId: parsed.event_id ?? null,
      userId,
      locale,
    }).catch(err => {
      console.error('[slack/events] dispatch failed:', err);
    });
  }

  return NextResponse.json({ ok: true });
}

function shouldDispatchToAgent(event: SlackEvent): boolean {
  // Never loop on our own replies.
  if (event.bot_id || event.subtype === 'bot_message') return false;

  // DMs to the bot.
  if (event.type === 'message' && (event as SlackEvent).channel_type === 'im') return true;

  // Explicit mentions in channels.
  if (event.type === 'app_mention') return true;

  return false;
}

async function dispatchAndReply(args: {
  req: NextRequest;
  tenantId: string;
  botToken: string;
  event: SlackEvent;
  eventId: string | null;
  userId: string;
  locale: string;
}): Promise<void> {
  const dispatchUrl = new URL('/api/agent/dispatch', args.req.nextUrl.origin);

  const body: {
    tenantId: string;
    userId: string;
    channel: 'slack';
    text: string;
    locale: string;
    turnId?: string;
  } = {
    tenantId: args.tenantId,
    userId: args.userId,
    channel: 'slack',
    text: (args.event.text ?? '').slice(0, 4000),
    locale: args.locale,
  };
  if (args.eventId) body.turnId = `slack:${args.eventId}`;

  const response = await fetch(dispatchUrl, {
    method: 'POST',
    headers: agentDispatchHeaders(),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const reason = await response.text();
    console.error(`[slack/events] dispatch HTTP ${response.status}:`, reason);
    return;
  }

  const json = (await response.json()) as { text?: string };
  if (!json.text) return;

  const channel = args.event.channel;
  if (!channel) return;

  const client = createSlackClient(args.botToken);
  try {
    await postMessage(client, {
      channel,
      text: json.text,
      threadTs: args.event.thread_ts ?? args.event.ts,
    });
  } catch (err) {
    console.error('[slack/events] postMessage failed:', err);
  }
}

function agentDispatchHeaders() {
  const secret = process.env.AGENT_DISPATCH_SECRET ?? process.env.CRON_SECRET ?? '';
  return {
    'Content-Type': 'application/json',
    'x-sendero-dispatch-secret': secret,
  };
}

function requestLocale(req: NextRequest): string {
  return detectLocale({
    acceptLanguage: req.headers.get('x-sendero-locale') ?? req.headers.get('accept-language'),
    country: req.headers.get('x-vercel-ip-country') ?? req.headers.get('cf-ipcountry'),
  });
}

async function resolveInstall(
  enterpriseId: string | null,
  teamId: string | null
): Promise<{ tenantId: string; botToken: string } | null> {
  if (!teamId) return null;
  const install = await prisma.slackInstall.findFirst({
    where: {
      teamId,
      ...(enterpriseId ? { enterpriseId } : {}),
    },
    select: { tenantId: true, botToken: true },
  });
  return install;
}
