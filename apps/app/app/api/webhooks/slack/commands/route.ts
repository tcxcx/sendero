/**
 * Slack slash-command endpoint — `/sendero …`.
 *
 * Verifies HMAC + 5-min replay window via `verifySlackSignature`,
 * resolves the install (revocation-aware), parses the body via
 * `parseSlashCommandBody`, and dispatches via `SlashCommandRouter`.
 *
 * Subcommands today:
 *   /sendero help                  → ephemeral usage card
 *   /sendero status <trip-id>      → trip status (ephemeral)
 *   /sendero note <trip-id>        → opens the trip-note modal
 *
 * Slack requires a 200 ack within 3 seconds. The dispatcher returns
 * either an immediate body (`kind: 'reply'`) or an empty 200 ack
 * (`kind: 'ack'`); long work for the latter happens in `after()` and
 * posts to `response_url` post-ack.
 *
 * `views.open` for `/sendero note` runs synchronously because the
 * `trigger_id` has a 3-second TTL — we can't defer that opener past
 * `after()` or the trigger expires before we use it.
 */

import { after, NextResponse, type NextRequest } from 'next/server';

import { prisma } from '@sendero/database';
import { env } from '@sendero/env';
import {
  createSlackClient,
  openView,
  parseSlashCommandBody,
  respondToInteraction,
  serializeSlashCommandResult,
  SlashCommandRouter,
  verifySlackSignature,
  type SlashCommandPayload,
  type SlashCommandResult,
} from '@sendero/slack';

import { buildTripNoteView } from '@/lib/slack-views/trip-note';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const signingSecret = env.slackSigningSecret();
  if (!signingSecret) {
    return NextResponse.json({ error: 'slack_not_configured' }, { status: 503 });
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

  const payload = parseSlashCommandBody(rawBody);
  if (!payload) {
    return NextResponse.json({}, { status: 400 });
  }

  const teamId = payload.team.id;
  const enterpriseId = payload.enterprise?.id ?? null;

  if (!teamId) {
    return NextResponse.json({ error: 'missing_team_id' }, { status: 400 });
  }

  const install = await prisma.slackInstall.findFirst({
    where: { teamId, ...(enterpriseId ? { enterpriseId } : {}) },
  });
  if (!install) {
    return NextResponse.json(
      {
        response_type: 'ephemeral',
        text: 'Sendero is not installed in this workspace. Visit your Sendero dashboard → Channels → Slack to install.',
      },
      { status: 200 }
    );
  }
  if (install.teamId !== teamId || (install.enterpriseId ?? null) !== (enterpriseId ?? null)) {
    return NextResponse.json({ error: 'install_mismatch' }, { status: 403 });
  }
  if (install.revokedAt !== null) {
    return NextResponse.json({
      response_type: 'ephemeral',
      text: 'Sendero was uninstalled or its token was revoked. Reinstall from the dashboard to re-enable slash commands.',
    });
  }

  // Build the router fresh per request so handlers can close over the
  // resolved install (token, tenant scoping). The map building is O(commands)
  // and these are cheap object inserts.
  const router = buildRouter(install.botToken);

  let result: SlashCommandResult;
  try {
    result = await router.dispatch(payload);
  } catch (err) {
    console.error('[slack/commands] dispatch failed:', {
      command: payload.command,
      subcommand: payload.subcommand,
      userId: payload.user.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({
      response_type: 'ephemeral',
      text: 'I hit an error running that command. Try again, or check the Sendero dashboard if it persists.',
    });
  }

  return NextResponse.json(serializeSlashCommandResult(result));
}

// ─── command registry ─────────────────────────────────────────────────

function buildRouter(botToken: string): SlashCommandRouter {
  return new SlashCommandRouter()
    .register('/sendero', 'help', handleHelp)
    .register('/sendero', '', handleHelp) // bare `/sendero` → help
    .register('/sendero', 'note', payload => handleNote(payload, botToken))
    .register('/sendero', 'status', handleStatus);
}

// ─── handlers ─────────────────────────────────────────────────────────

async function handleHelp(_payload: SlashCommandPayload): Promise<SlashCommandResult> {
  return {
    kind: 'reply',
    responseType: 'ephemeral',
    text: [
      '*Sendero slash commands*',
      '',
      '`/sendero help` — show this message',
      '`/sendero status <trip-id>` — quick trip status',
      '`/sendero note <trip-id>` — add an operator note to a trip',
      '',
      'Or just @-mention me in a channel — I can search flights, hold options, request approvals, and book.',
    ].join('\n'),
  };
}

async function handleStatus(payload: SlashCommandPayload): Promise<SlashCommandResult> {
  const tripId = payload.args.split(/\s+/)[0]?.trim() ?? '';
  if (!tripId) {
    return {
      kind: 'reply',
      responseType: 'ephemeral',
      text: 'Usage: `/sendero status <trip-id>`',
    };
  }

  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: {
      id: true,
      tenantId: true,
      status: true,
      intent: true,
      totalUsdc: true,
      createdAt: true,
    },
  });
  if (!trip) {
    return {
      kind: 'reply',
      responseType: 'ephemeral',
      text: `Trip \`${tripId}\` not found.`,
    };
  }

  const summary = summarizeIntent(trip.intent);
  return {
    kind: 'reply',
    responseType: 'ephemeral',
    text: [
      `*Trip \`${trip.id}\`*`,
      `Status: \`${trip.status}\``,
      summary ? `Route: ${summary}` : null,
      trip.totalUsdc ? `Total: ${trip.totalUsdc.toString()} USDC` : null,
      `Created: ${trip.createdAt.toISOString()}`,
    ]
      .filter(Boolean)
      .join('\n'),
  };
}

async function handleNote(
  payload: SlashCommandPayload,
  botToken: string
): Promise<SlashCommandResult> {
  const tripId = payload.args.split(/\s+/)[0]?.trim() ?? '';
  if (!tripId) {
    return {
      kind: 'reply',
      responseType: 'ephemeral',
      text: 'Usage: `/sendero note <trip-id>`',
    };
  }

  // trigger_id has a 3-second TTL — `views.open` MUST run before this
  // POST returns. We've already verified the signature + install above
  // (cheap), so this is well within budget.
  const view = buildTripNoteView({
    tripId,
    channelId: payload.channel.id,
  });

  const client = createSlackClient(botToken);
  try {
    await openView(client, { triggerId: payload.triggerId, view });
  } catch (err) {
    // Most likely failure: trigger_id expired (slow webhook chain), or
    // bot lacks `commands` scope on the workspace. Fall back to an
    // ephemeral message in the channel.
    const message =
      err instanceof Error && /trigger_expired|trigger_id_expired/.test(err.message)
        ? 'Try again — Slack expired the modal trigger before it opened.'
        : 'Could not open the note modal. Check that Sendero has the right Slack permissions.';
    // Defer the response_url post past the ack so this method returns fast.
    after(async () => {
      try {
        await respondToInteraction(payload.responseUrl, {
          response_type: 'ephemeral',
          text: message,
        });
      } catch (postErr) {
        console.error('[slack/commands] note fallback failed:', postErr);
      }
    });
    return { kind: 'ack' };
  }

  // Ack with no body — the modal is the user's "I got it" signal.
  return { kind: 'ack' };
}

// ─── helpers ──────────────────────────────────────────────────────────

function summarizeIntent(intent: unknown): string | null {
  if (!intent || typeof intent !== 'object') return null;
  const i = intent as { origin?: unknown; dest?: unknown; destination?: unknown };
  const origin = typeof i.origin === 'string' ? i.origin : null;
  const dest =
    typeof i.dest === 'string' ? i.dest : typeof i.destination === 'string' ? i.destination : null;
  if (origin && dest) return `${origin} → ${dest}`;
  if (dest) return String(dest);
  return null;
}
