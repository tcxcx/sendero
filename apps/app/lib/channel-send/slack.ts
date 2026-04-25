/**
 * Slack send orchestrator.
 *
 * Composes the canonical channel-render layer with the @sendero/slack
 * send primitive. Callers pass a `ChannelMessage`; this module renders
 * via `renderForSlack`, opens a `WebClient` from the install's bot
 * token, and forwards the native Block Kit shape to `sendBlocks`.
 *
 * The dependency direction is one-way: apps/app composes the package
 * primitive; the package never imports back into apps. That keeps the
 * workspace cycle-free and lets the package compile without the
 * channel-render module on its classpath.
 *
 * Returns `{ sent: false, reason }` when the canonical kind is
 * intentionally not relayed to Slack (e.g. raw `tool_invocation` outside
 * an operator DM, raw `tool_result` without a `share` block). Otherwise
 * returns the posted message handle from `chat.postMessage`.
 */

import type { SlackInstall } from '@prisma/client';
import type { KnownBlock } from '@slack/web-api';
import { createSlackClient, sendBlocks } from '@sendero/slack';
import { renderForSlack } from '@/lib/channel-render';
import type { ChannelMessage } from '@/lib/channel-render';

export interface SendSlackArgs {
  install: SlackInstall;
  /** User id (DM) or channel id, already resolved by the caller. */
  channel: string;
  threadTs?: string;
  message: ChannelMessage;
}

export type SendSlackResult =
  | { sent: false; reason: string }
  | { sent: true; channel: string; ts: string; degraded?: boolean };

export async function sendChannelMessageSlack(args: SendSlackArgs): Promise<SendSlackResult> {
  const rendered = await renderForSlack(args.message);
  if (!rendered) {
    return { sent: false, reason: 'kind-not-relayed-to-slack' };
  }

  const client = createSlackClient(args.install.botToken);
  const posted = await sendBlocks({
    client,
    channel: args.channel,
    threadTs: args.threadTs,
    text: rendered.payload.text,
    // Cast through KnownBlock[]: the renderer types blocks as
    // `unknown[]` to keep apps/app/lib/channel-render decoupled from
    // @slack/types. Every shape it emits is a valid Block Kit block —
    // see `apps/app/lib/channel-render/channels/slack.ts`.
    blocks: rendered.payload.blocks as KnownBlock[] | undefined,
  });

  return {
    sent: true,
    channel: posted.channel,
    ts: posted.ts,
    degraded: rendered.degraded,
  };
}
