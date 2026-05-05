/**
 * @sendero apps/app channel-render package — CLIENT-SAFE entrypoint.
 *
 * Re-exports only the canonical types + the operator (web) renderer.
 * Web/operator client bundles can import this without dragging in
 * Node-only packages.
 *
 * Server-side channel renderers live in `channels/` and import server-
 * only deps (e.g. `@sendero/slack` → `@slack/web-api` → `node:fs`).
 * Import them DIRECTLY from `./channels/{slack|whatsapp|web}` in
 * server-side code (route handlers, channel-send orchestrators, edge/
 * webhook routes). NEVER re-export them from this index — doing so
 * leaks Node-only modules into the client bundle and crashes Next.js
 * with `Cannot find module 'node:fs'`.
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
  ChannelMessageEsimActivation,
  ChannelKind,
  ChannelRole,
  ChannelAuthor,
  ChannelCta,
  ChannelRenderer,
  RenderedForChannel,
} from './types';

export { renderForOperator } from './operator';

// Channel renderers intentionally NOT re-exported. Import them from
// the per-channel module directly in server-only code:
//   import { renderForSlack } from '@/lib/channel-render/channels/slack';
//   import { renderForWhatsApp } from '@/lib/channel-render/channels/whatsapp';
//   import { renderForWeb } from '@/lib/channel-render/channels/web';
