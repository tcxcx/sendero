/**
 * Phase C-2 — Slack adapter (operator DMs only in v1).
 *
 * Looks up the recipient's Slack user id via `SlackUserBinding`
 * (Sendero's mapping from Clerk userId → Slack user/team), then sends
 * a chat.postMessage DM via the tenant's Slack install bot token.
 *
 * v1 scope: operator recipients only. Traveler-side messages stay
 * routed through `apps/app/lib/channel-routing.ts::sendShareOnTrip` —
 * the dispatcher does not centralize traveler channel resolution.
 *
 * Failure modes (no double-fire risk in any of these — each returns
 * `ok: false` and the dispatch row records `status: 'failed'`):
 *   - No Slack install for tenant       → "tenant has no Slack install"
 *   - No SlackUserBinding for user      → "operator not bound to Slack"
 *   - Slack API rejects (rate limit)    → surface the error message
 *   - SLACK_BOT_TOKEN absent in env     → "no Slack credentials"
 */

import { WebClient } from '@slack/web-api';

import { prisma } from '@sendero/database';

import type { ChannelAdapter } from '../dispatch';

export const slackAdapter: ChannelAdapter = async ({ event, recipient, context }) => {
  const install = await prisma.slackInstall.findFirst({
    where: { tenantId: context.tenantId, revokedAt: null },
    select: { botToken: true, teamId: true },
  });
  if (!install || !install.botToken) {
    return { ok: false, error: 'tenant has no active Slack install' };
  }

  // SlackUserBinding maps Sendero User.id → Slack user. The dispatcher
  // recipient carries Clerk userId, so resolve Sendero User.id first.
  const senderoUser = await prisma.user.findUnique({
    where: { clerkUserId: recipient.userId },
    select: { id: true },
  });
  if (!senderoUser) {
    return { ok: false, error: 'operator has no Sendero user row' };
  }
  const binding = await prisma.slackUserBinding.findFirst({
    where: {
      tenantId: context.tenantId,
      slackTeamId: install.teamId,
      senderoUserId: senderoUser.id,
    },
    select: { slackUserId: true },
  });
  if (!binding) {
    return { ok: false, error: 'operator not bound to Slack (no SlackUserBinding)' };
  }

  const data = (event.data ?? {}) as Record<string, unknown>;
  const title = typeof data.title === 'string' ? data.title : defaultTitleFor(event.kind);
  const message = typeof data.message === 'string' ? data.message : '';
  const url =
    typeof data.url === 'string'
      ? data.url
      : event.tripId
        ? `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/dashboard/console?tripId=${event.tripId}`
        : null;

  try {
    const slack = new WebClient(install.botToken);
    const text = `*${title}*${message ? `\n${message}` : ''}${url ? `\n<${url}|Open in Sendero>` : ''}`;
    const result = await slack.chat.postMessage({
      channel: binding.slackUserId, // direct DM via user id
      text,
      mrkdwn: true,
    });
    if (!result.ok) {
      return { ok: false, error: `slack chat.postMessage failed: ${result.error ?? 'unknown'}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
};

function defaultTitleFor(eventKind: string): string {
  switch (eventKind) {
    case 'handoff.requested':
      return 'Operator handoff requested';
    case 'booking.confirmed':
      return 'Booking confirmed';
    case 'mention.received':
      return 'You were mentioned';
    default:
      return 'Sendero notification';
  }
}
