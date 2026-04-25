/**
 * Slack channel renderer (STUB).
 *
 * Translates a `ChannelMessage` into a Slack chat.postMessage payload.
 * The operator (DM) and channel-routed (public/private) Slack UIs both
 * consume the same Block Kit blocks — this renderer's output flows
 * straight into the existing `@sendero/slack` send helpers.
 *
 * Reference: https://api.slack.com/block-kit
 *
 * Approval cards already use Block Kit via `buildApprovalBlocks` in
 * `packages/slack/src/approval.ts`. This renderer subsumes that one
 * day; for now the stub points at the same surface.
 *
 * STATUS: stub interfaces only. Wire-up is a follow-up PR.
 */

import type { ChannelMessage, ChannelRenderer, RenderedForChannel } from '../types';

/**
 * Slack chat.postMessage subset. Use Slack's KnownBlock when narrowing
 * downstream — kept loose here so this stub doesn't pull `@slack/web-api`
 * types into the channel-render package.
 */
export interface SlackPayload {
  channel: string;
  thread_ts?: string;
  text: string;
  blocks?: unknown[];
  attachments?: unknown[];
}

export const renderForSlack: ChannelRenderer<SlackPayload> = (
  msg: ChannelMessage
): RenderedForChannel<SlackPayload> | null => {
  // STUB: real implementations land in a follow-up. The existing
  // approval-card path stays in `packages/slack/src/approval.ts` until
  // that gets folded into this renderer.
  void msg;
  return null;
};
