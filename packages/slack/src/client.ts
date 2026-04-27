/**
 * Thin convenience wrapper around @slack/web-api.
 * The consuming app resolves the bot token per-tenant via TokenStore and
 * instantiates a client per request.
 */

import { WebClient } from '@slack/web-api';
import type { KnownBlock, View } from '@slack/web-api';

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

/**
 * Open a Block Kit modal in response to a `trigger_id` (interactivity
 * payload — button click, slash command, shortcut). Slack's `trigger_id`
 * has a 3-second TTL from when the user interacted, so call sites must
 * not block on long work before this.
 *
 * Returns the `view.id` so callers can later `views.update(viewId, …)`
 * for multi-step flows.
 */
export async function openView(
  client: WebClient,
  args: { triggerId: string; view: View }
): Promise<string> {
  const res = await client.views.open({
    trigger_id: args.triggerId,
    view: args.view,
  });
  const viewId = res.view?.id;
  if (!viewId) throw new Error('views.open returned no view id');
  return viewId;
}

/**
 * Upload a file (binary or text) into a Slack channel/thread. Wraps
 * `files.uploadV2` — Slack deprecated the legacy `files.upload` in
 * March 2025, so v2 is the only supported path. Both single-channel
 * and multi-thread shares use the same call; pass the optional
 * `threadTs` to drop the file into a thread instead of channel-top.
 *
 * Returns the file id so callers can reference the upload in follow-up
 * messages (e.g. `<https://files.slack.com/…|See attachment>`).
 */
export async function uploadFile(
  client: WebClient,
  args: {
    channel: string;
    filename: string;
    content: string | Buffer;
    title?: string;
    initialComment?: string;
    threadTs?: string;
  }
): Promise<string> {
  const res = await client.files.uploadV2({
    channel_id: args.channel,
    filename: args.filename,
    file: args.content,
    title: args.title,
    initial_comment: args.initialComment,
    thread_ts: args.threadTs,
  });
  // uploadV2's response shape: `files: [{ id, … }]` on success. The
  // SDK types this as the loose `WebAPICallResult`, so we cast to read
  // `files`. Pull the first id; multi-file uploads aren't a use case
  // Sendero exposes today.
  const filesField = (res as { files?: unknown }).files;
  const file = Array.isArray(filesField) ? (filesField[0] as unknown) : undefined;
  const fileId =
    file && typeof file === 'object' && 'id' in file
      ? ((file as { id?: string }).id ?? undefined)
      : undefined;
  if (!fileId) throw new Error('files.uploadV2 returned no file id');
  return fileId;
}
