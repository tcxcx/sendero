/**
 * Slack dispatch helper. Extracted so the WhatsApp-only path doesn't
 * have to pay the `@slack/web-api` import cost.
 *
 * Ported from desk-v1 `notifyChannels()` pattern, adapted for Sendero.
 */

import { prisma } from '@sendero/database';
import { WebClient } from '@slack/web-api';

export interface SendSlackDirectArgs {
  tenantId: string;
  channelId: string;
  mrkdwn: string;
  linkText?: string;
}

export async function sendSlackDirect(args: SendSlackDirectArgs): Promise<string> {
  const install = await prisma.slackInstall.findFirst({
    where: { tenantId: args.tenantId, revokedAt: null },
    select: { botToken: true },
    orderBy: { installedAt: 'desc' },
  });
  if (!install) throw new Error('slack:no_install_for_tenant');

  const client = new WebClient(install.botToken);
  const text = args.linkText ? `${args.mrkdwn}\n${args.linkText}` : args.mrkdwn;
  const res = await client.chat.postMessage({
    channel: args.channelId,
    text,
    mrkdwn: true,
  });
  if (!res.ok || !res.ts) {
    throw new Error(`slack:post_message_failed:${res.error ?? 'unknown'}`);
  }
  return res.ts;
}
