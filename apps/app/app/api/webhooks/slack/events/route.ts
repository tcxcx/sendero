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

import { after, type NextRequest, NextResponse } from 'next/server';

import { prisma } from '@sendero/database';
import { env } from '@sendero/env';
import {
  deriveTenantKey,
  isUrlVerificationChallenge,
  type SlackEventEnvelope,
  verifySlackSignature,
} from '@sendero/slack';

import { makeCapStore, makeMeterStore, makeSessionStore, resolveSegment } from '@/lib/agent-stores';
import { newTraceId } from '@/lib/api-errors';
import { runSlackAgentTurn } from '@/lib/slack-agent';
import { fetchSlackFilesAsAttachments } from '@/lib/slack-media';
import { resolveSenderoUser } from '@/lib/slack-user-mapping';

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

  // Event-type filter — only dispatch the agent on events the operator
  // actually addressed Sendero in. Without this, every `channel_rename`,
  // `member_joined_channel`, `pin_added`, etc. would burn an agent turn
  // and (worse) post a noise reply into the originating thread. We
  // accept the conservative trio: app_mention (explicit @-mention),
  // message.im (DMs), message.channels with a non-empty body in a
  // channel where the bot is a member. Bot-authored messages are
  // skipped to avoid self-reply loops (subtype === 'bot_message' or
  // user matches install.botUserId).
  const eventType = (ev?.type as string | undefined) ?? null;
  const eventSubtype = (ev?.subtype as string | undefined) ?? null;
  const isBotEcho = userId === install.botUserId || eventSubtype === 'bot_message';
  const isAgentInput =
    !isBotEcho &&
    (eventType === 'app_mention' ||
      (eventType === 'message' && text.trim().length > 0 && !eventSubtype));
  if (!isAgentInput) {
    console.log('[slack/events] skip non-agent event', {
      eventType,
      eventSubtype,
      isBotEcho,
      teamId: install.teamId,
      eventId: envelope.event_id,
    });
    return NextResponse.json({ ok: true });
  }
  // Cross-phase autoplan ask: every webhook entry gets a correlation id
  // we can grep across the call graph (events → agent turn → meter row).
  const traceId = newTraceId();
  console.log('[slack/events] inbound', {
    traceId,
    teamId: install.teamId,
    channelId,
    eventId: envelope.event_id,
    threadTs,
    hasText: Boolean(text),
    fileCount: Array.isArray(ev?.files) ? (ev?.files as unknown[]).length : 0,
  });
  // Slack delivers shared files inline on the event envelope as `files[]`.
  // We pull them off here so the file fetch happens inside `after()`
  // (auth'd download is slow) and the route still acks within Slack's 3s.
  const rawFiles = Array.isArray(ev?.files) ? (ev?.files as unknown[]) : [];

  // Defer the agent turn past the ack — Slack only needs `{ ok: true }`
  // within 3s; the LLM call can take much longer on cold paths. The Slack
  // user → Sendero user resolve also runs inside `after()` because on
  // cache miss it hits `slack.users.info` (slow path).
  after(async () => {
    try {
      // Resolve the actual Slack user → Sendero User per webhook. Caches in
      // SlackUserBinding so repeat messages from the same person don't keep
      // hitting slack.users.info. Auto-provisions a Sendero User when the
      // Slack user has no existing match (provisional row, can be claimed
      // later via Clerk sign-up with the same email). When the inbound
      // event has no `user.id` (system events, channel-renames, etc.) we
      // fall back to the install admin's userId — there's no message author
      // to resolve.
      const resolvedSenderoUserId = userId
        ? (
            await resolveSenderoUser({
              tenantId: install.tenantId,
              slackTeamId: install.teamId,
              slackUserId: userId,
              botToken: install.botToken,
              // meter_events.userId is FK'd to User.id — the resolver MUST
              // return a non-null id even on total failure. authedUserId is
              // the install admin's id, so it's a known-good User row.
              fallbackUserId: install.authedUserId,
            })
          ).senderoUserId
        : install.authedUserId;

      // Fetch any inline file shares with the bot token. Slack's
      // url_private requires Authorization, so we download here and pass
      // the bytes through as base64 attachments — the agent runtime then
      // exposes them as multimodal model parts and nudges the LLM toward
      // `scan_document_auto`. Failures (private channels, expired tokens,
      // oversize) are logged but never block the agent turn.
      const attachments = rawFiles.length
        ? await fetchSlackFilesAsAttachments(rawFiles, install.botToken)
        : [];

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
        senderoUserId: resolvedSenderoUserId,
        ...(attachments.length ? { attachments } : {}),
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
      console.error('[slack/events] runSlackAgentTurn failed:', {
        traceId,
        teamId: install.teamId,
        channelId,
        threadTs,
        eventId: envelope.event_id,
        error: err instanceof Error ? err.message : String(err),
      });
      // Best-effort fallback so the user doesn't see dead silence in the
      // thread. If posting the fallback also fails (token revoked, etc.)
      // we just log — never re-throw past `after()`, that bubbles up as
      // an unhandled rejection in the Vercel runtime.
      if (channelId && threadTs) {
        try {
          const { createSlackClient } = await import('@sendero/slack');
          const slack = createSlackClient(install.botToken);
          await slack.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            text: "I'm having trouble reaching the agent right now. Please try again in a minute — your message did come through.",
            mrkdwn: true,
            unfurl_links: false,
          });
        } catch (fallbackErr) {
          console.error('[slack/events] fallback post failed:', {
            error: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
          });
        }
      }
    }
  });

  return NextResponse.json({ ok: true });
}
