/**
 * Slack send primitive for canonical channel-render payloads.
 *
 * Thin wrapper over `chat.postMessage` that takes an already-rendered
 * Block Kit payload (text fallback + blocks) and posts it. The canonical
 * `apps/app/lib/channel-render` layer renders a `ChannelMessage` into
 * the native shape; the orchestrator at `apps/app/lib/channel-send`
 * forwards that shape through here so this package never imports from
 * `apps/app` (no workspace cycle, no `@/lib/...` resolution).
 *
 * Pre-existing helpers (`postMessage` in `./client`, `sendApprovalRequest`
 * in `./approval`) stay intact for backward compatibility. New senders
 * should target `sendBlocks` so canonical-render becomes the single
 * source of truth at the wire edge.
 */

import type { WebClient, KnownBlock } from '@slack/web-api';

export interface SendBlocksArgs {
  client: WebClient;
  /** User id (DM) or channel id, already resolved by the caller. */
  channel: string;
  threadTs?: string;
  /** Plain-text fallback for notifications + a11y. */
  text: string;
  blocks?: KnownBlock[];
}

export async function sendBlocks(
  args: SendBlocksArgs
): Promise<{ channel: string; ts: string }> {
  const r = await args.client.chat.postMessage({
    channel: args.channel,
    thread_ts: args.threadTs,
    text: args.text,
    blocks: args.blocks,
  });
  if (!r.ts || !r.channel) {
    throw new Error('chat.postMessage returned no ts/channel');
  }
  return { channel: r.channel, ts: r.ts };
}
