/**
 * @sendero apps/app channel-render package
 *
 * Single source of truth for cross-channel message rendering.
 * Operator console (web) consumes via `renderForOperator`; traveler-
 * side WhatsApp / Slack / web / email each consume via their own
 * renderer in `channels/`. All renderers receive the same canonical
 * `ChannelMessage` so the operator preview and the traveler's actual
 * native channel UI render the same content.
 */

export type {
  ChannelMessage,
  ChannelMessageText,
  ChannelMessageCard,
  ChannelMessageToolInvocation,
  ChannelMessageToolResult,
  ChannelMessageApprovalRequest,
  ChannelMessageReasoning,
  ChannelMessageSources,
  ChannelKind,
  ChannelRole,
  ChannelAuthor,
  ChannelCta,
  ChannelRenderer,
  RenderedForChannel,
} from './types';

export { renderForOperator } from './operator';
export { renderForWhatsApp } from './channels/whatsapp';
export { renderForSlack } from './channels/slack';
export { renderForWeb } from './channels/web';
