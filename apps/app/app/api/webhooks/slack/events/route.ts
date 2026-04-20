/**
 * Slack Events API endpoint.
 *
 * Verifies HMAC + 5-min replay window, responds to `url_verification`
 * challenge, persists a ChannelIdentity on every user event, then
 * short-circuits — actual handling (mentions, DMs) lands in Phase 3.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { env } from '@sendero/env';
import { prisma } from '@sendero/database';
import {
  deriveTenantKey,
  isUrlVerificationChallenge,
  verifySlackSignature,
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
          metadata: { teamId, enterpriseId },
        },
        update: { metadata: { teamId, enterpriseId } },
      });
    } catch (err) {
      console.error('[slack/events] identity upsert failed:', err);
    }
  }

  // TODO (Phase 3): dispatch to the per-trip agent based on event.type
  // (message.im, app_mention, assistant_thread_started).

  return NextResponse.json({ ok: true });
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
