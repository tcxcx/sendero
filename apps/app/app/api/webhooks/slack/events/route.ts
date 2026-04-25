/**
 * Slack Events API endpoint.
 *
 * Verifies HMAC + 5-minute replay window, responds to `url_verification`
 * challenge, then delegates to `runSlackAgentTurn` from `@/lib/slack-agent`
 * for all DM / app-mention agent work. Slack requires a 200 ack within
 * 3 seconds; we ack immediately and run the agent in `after()` so the
 * webhook returns fast even when the LLM turn takes longer.
 *
 * Hardening: after `prisma.slackInstall.findFirst({ teamId, enterpriseId })`,
 * we re-validate the resolved row's `teamId` / `enterpriseId` match the
 * envelope — defence against malformed payloads claiming a different team
 * than the install row's primary key would suggest.
 */

import { after, NextResponse, type NextRequest } from 'next/server';
import { env } from '@sendero/env';
import { prisma } from '@sendero/database';
import {
  deriveTenantKey,
  isUrlVerificationChallenge,
  verifySlackSignature,
  type SlackEventEnvelope,
} from '@sendero/slack';
import { runSlackAgentTurn } from '@/lib/slack-agent';
import { makeCapStore, makeMeterStore, makeSessionStore, resolveSegment } from '@/lib/agent-stores';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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

  let envelope: SlackEventEnvelope;
  try {
    envelope = JSON.parse(rawBody) as SlackEventEnvelope;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  // First-time URL verification handshake.
  if (isUrlVerificationChallenge(envelope)) {
    return NextResponse.json({ challenge: envelope.challenge });
  }

  const { enterpriseId, teamId } = deriveTenantKey(envelope);
  if (!teamId) {
    return NextResponse.json({ error: 'missing_team_id' }, { status: 400 });
  }

  const install = await prisma.slackInstall.findFirst({
    where: {
      teamId,
      ...(enterpriseId ? { enterpriseId } : {}),
    },
  });

  // 404 (not 200) when the install is unknown so onboarding misconfig is
  // visible in Slack's webhook delivery dashboard.
  if (!install) {
    return NextResponse.json({ error: 'unknown_install' }, { status: 404 });
  }

  // Defence-in-depth: confirm the resolved row's tenant key matches the
  // envelope. Guards against malformed payloads where `team_id` was
  // satisfied by a partial match while the canonical fields disagree.
  if (install.teamId !== teamId || (install.enterpriseId ?? null) !== (enterpriseId ?? null)) {
    return NextResponse.json({ error: 'install_mismatch' }, { status: 403 });
  }

  const ev = envelope.event;
  const channelId = (ev?.channel as string | undefined) ?? null;
  const userId = (ev?.user as string | undefined) ?? null;
  const text = (ev?.text as string | undefined) ?? '';
  const threadTs = (ev?.thread_ts as string | undefined) ?? (ev?.ts as string | undefined);

  // Defer the agent turn past the ack — Slack only needs `{ ok: true }`
  // within 3s; the LLM call can take much longer on cold paths.
  after(async () => {
    try {
      await runSlackAgentTurn({
        // Prisma's `routing: JsonValue` is structurally compatible with
        // SlackRoutingConfig | null at runtime; the agent's prompt-builder
        // narrows it defensively. Cast at the boundary.
        install: install as unknown as Parameters<typeof runSlackAgentTurn>[0]['install'],
        envelope,
        text,
        threadTs,
        channelId,
        userId,
        // TODO(slack-user-mapping): resolve a Sendero user ID from the Slack
        // userId. For now, use the install's authedUserId as a stand-in so
        // turn telemetry attributes back to the workspace admin who installed.
        senderoUserId: install.authedUserId,
        // Model intentionally omitted — slack-agent resolves via the
        // canonical Sendero policy: Gateway-first (Gemini-first cascade
        // google→anthropic→openai), direct-provider fallback on gateway
        // failure. Same path as the dispatch route.
        capStore: makeCapStore(),
        meterStore: makeMeterStore(),
        sessionStore: makeSessionStore(),
        resolveSegment,
      });
    } catch (err) {
      console.error('[slack/events] runSlackAgentTurn failed:', err);
    }
  });

  return NextResponse.json({ ok: true });
}
