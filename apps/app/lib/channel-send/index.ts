/**
 * Channel-send orchestrators.
 *
 * Compose the canonical `apps/app/lib/channel-render` layer with the
 * package-level send primitives in `@sendero/slack` + `@sendero/whatsapp`.
 *
 * Callers pass a canonical `ChannelMessage`; the orchestrators render to
 * the native shape and forward to the Cloud API / chat.postMessage. Any
 * call site that previously hand-built Block Kit or interactive payloads
 * should migrate here — this is the single source of truth at the wire
 * edge.
 */

export { sendChannelMessageSlack } from './slack';
export type { SendSlackArgs, SendSlackResult } from './slack';

export { sendChannelMessageWhatsApp } from './whatsapp';
export type { SendWhatsAppArgs, SendWhatsAppResult } from './whatsapp';

export {
  shareCardsToChannelMessages,
  dispatchAgentShareCardsWhatsApp,
  dispatchAgentShareCardsSlack,
} from './agent-share-cards';
export type { AgentShareCard, DispatchShareCardsResult } from './agent-share-cards';

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
} from '@/lib/channel-render';
