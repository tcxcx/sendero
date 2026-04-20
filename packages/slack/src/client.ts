/**
 * Thin convenience wrapper around @slack/web-api.
 * The consuming app resolves the bot token per-tenant via TokenStore and
 * instantiates a client per request.
 */

import { WebClient } from '@slack/web-api';
import type { KnownBlock } from '@slack/web-api';

export function createSlackClient(botToken: string): WebClient {
  return new WebClient(botToken);
}

export interface PostMessageArgs {
  channel: string;
  text?: string;
  blocks?: KnownBlock[];
  threadTs?: string;
  unfurlLinks?: boolean;
  mrkdwn?: boolean;
}

export async function postMessage(client: WebClient, args: PostMessageArgs) {
  return client.chat.postMessage({
    channel: args.channel,
    text: args.text ?? '',
    blocks: args.blocks,
    thread_ts: args.threadTs,
    unfurl_links: args.unfurlLinks ?? false,
    mrkdwn: args.mrkdwn ?? true,
  });
}

/** Replace a prior interactive message (e.g. resolve an approval card). */
export async function updateMessage(
  client: WebClient,
  args: { channel: string; ts: string; text?: string; blocks?: KnownBlock[] }
) {
  return client.chat.update({
    channel: args.channel,
    ts: args.ts,
    text: args.text ?? '',
    blocks: args.blocks,
  });
}

/** Open a DM with a user and return the channel id for further messages. */
export async function openDm(client: WebClient, userId: string): Promise<string> {
  const res = await client.conversations.open({ users: userId });
  const channelId = res.channel?.id;
  if (!channelId) throw new Error(`Failed to open DM with ${userId}`);
  return channelId;
}
