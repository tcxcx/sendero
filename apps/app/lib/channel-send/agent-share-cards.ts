/**
 * Cross-channel agent share-card dispatcher.
 *
 * `runAgentTurn` collects every tool result that opted into the
 * canonical `share` payload (search_flights, hold, book_flight,
 * cancel_order_quote, …) and surfaces them on `AgentTurnResult.shareCards`.
 * This module turns those into `ChannelMessage[]` (kind: tool_result)
 * and dispatches them through the per-channel orchestrators
 * (`sendChannelMessageWhatsApp`, `sendChannelMessageSlack`) so each
 * channel renders the card natively — WhatsApp interactive buttons,
 * Slack block kit, etc.
 *
 * Layering:
 *
 *   layer 1 (pure)  → shareCardsToChannelMessages(cards, ctx)
 *                     converts the canonical agent output into a
 *                     channel-agnostic `ChannelMessage[]` with CTAs
 *                     narrowed to the ChannelCta enum. Pure, testable
 *                     without IO.
 *
 *   layer 2 (per-channel) → existing `sendChannelMessageWhatsApp` /
 *                           `sendChannelMessageSlack` orchestrators
 *                           render to native + send.
 *
 *   layer 3 (this module) → per-channel bulk senders that wire layers
 *                           1+2 together. One call per channel from
 *                           the webhook / agent.
 *
 * Adding a new channel: implement `sendChannelMessageX`, then add a
 * thin `dispatchAgentShareCardsX` wrapper here. Layer 1 doesn't change.
 */

import type { WhatsAppInstall } from '@prisma/client';

import type { ChannelCta, ChannelMessage } from '@/lib/channel-render';

import { sendChannelMessageSlack, type SendSlackResult } from './slack';
import { sendChannelMessageWhatsApp, type SendWhatsAppResult } from './whatsapp';

/** Structural subset of SlackInstall the dispatcher needs. Lets
 *  callers from `slack-agent.ts` (which uses a structural
 *  `PersistedSlackInstall` to stay decoupled from Prisma) and routes
 *  using the full Prisma row both pass through unchanged. */
export interface SlackInstallSubset {
  botToken: string;
}

/** The share-card shape `runAgentTurn` emits. Mirrored from
 * `AgentOutput.shareCards` in `@sendero/agent` so we don't pull the
 * package type into client-bundled call sites. */
export interface AgentShareCard {
  toolName: string;
  share: {
    title: string;
    body: string;
    bullets?: string[];
    primaryCta?: { label: string; kind: string };
    secondaryCtas?: Array<{ label: string; kind: string }>;
    imageUrl?: string;
  };
}

const KNOWN_CTA_KINDS = new Set<ChannelCta['kind']>([
  'reply',
  'approve',
  'reject',
  'cancel',
  'confirm_change',
  'select_offer',
  'confirm_cancel',
  'open_link',
  'tool_invoke',
]);

/** Narrow an agent-emitted CTA (open string `kind`) into the closed
 *  `ChannelCta.kind` enum the renderer accepts. Anything that doesn't
 *  match a known kind degrades to `'open_link'` so the card still
 *  surfaces — better a generic button than dropping the card outright. */
function narrowCta(cta: { label: string; kind: string }): ChannelCta {
  const kind = (
    KNOWN_CTA_KINDS.has(cta.kind as ChannelCta['kind']) ? cta.kind : 'open_link'
  ) as ChannelCta['kind'];
  return { label: cta.label, kind };
}

interface ChannelMessageContext {
  /** Stable id prefix so each card gets a unique ChannelMessage.id. */
  idPrefix: string;
  /** Author label (defaults to the agent role). */
  authorName?: string;
}

/**
 * Pure conversion from agent share cards → canonical ChannelMessage[].
 * Caller passes a stable `idPrefix` (typically the inbound message id
 * or turn id) so each card has a deterministic, dedupable id.
 */
export function shareCardsToChannelMessages(
  cards: AgentShareCard[],
  ctx: ChannelMessageContext
): ChannelMessage[] {
  return cards.map((card, idx) => ({
    kind: 'tool_result',
    id: `${ctx.idPrefix}_${idx}_${card.toolName}`,
    author: { role: 'agent', name: ctx.authorName ?? 'Sendero' },
    toolName: card.toolName,
    result: null,
    share: {
      title: card.share.title,
      body: card.share.body,
      ...(card.share.bullets ? { bullets: card.share.bullets } : {}),
      ...(card.share.primaryCta ? { primaryCta: narrowCta(card.share.primaryCta) } : {}),
      ...(card.share.secondaryCtas
        ? { secondaryCtas: card.share.secondaryCtas.map(narrowCta) }
        : {}),
      ...(card.share.imageUrl ? { imageUrl: card.share.imageUrl } : {}),
    },
    createdAt: new Date().toISOString(),
  }));
}

// ── Per-channel dispatchers ──────────────────────────────────────────

export interface DispatchShareCardsResult {
  sent: number;
  skipped: Array<{ toolName: string; reason: string }>;
}

export async function dispatchAgentShareCardsWhatsApp(args: {
  install: WhatsAppInstall;
  recipient: string;
  cards: AgentShareCard[];
  idPrefix: string;
  /** Override credentials when the install row's accessToken isn't usable
   *  (e.g. Kapso-mediated installs). */
  accessToken?: string;
  /** Override the WhatsApp Cloud API base URL (e.g. Kapso Meta proxy). */
  apiBaseUrl?: string;
}): Promise<DispatchShareCardsResult> {
  if (args.cards.length === 0) return { sent: 0, skipped: [] };
  const messages = shareCardsToChannelMessages(args.cards, { idPrefix: args.idPrefix });
  const skipped: DispatchShareCardsResult['skipped'] = [];
  let sent = 0;
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]!;
    const card = args.cards[i]!;
    const result: SendWhatsAppResult = await sendChannelMessageWhatsApp({
      install: args.install,
      recipient: args.recipient,
      message,
      ...(args.accessToken ? { accessToken: args.accessToken } : {}),
      ...(args.apiBaseUrl ? { apiBaseUrl: args.apiBaseUrl } : {}),
    });
    if (result.sent === false) skipped.push({ toolName: card.toolName, reason: result.reason });
    else sent++;
  }
  return { sent, skipped };
}

export async function dispatchAgentShareCardsSlack(args: {
  install: SlackInstallSubset;
  channel: string;
  threadTs?: string;
  cards: AgentShareCard[];
  idPrefix: string;
}): Promise<DispatchShareCardsResult> {
  if (args.cards.length === 0) return { sent: 0, skipped: [] };
  const messages = shareCardsToChannelMessages(args.cards, { idPrefix: args.idPrefix });
  const skipped: DispatchShareCardsResult['skipped'] = [];
  let sent = 0;
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]!;
    const card = args.cards[i]!;
    const result: SendSlackResult = await sendChannelMessageSlack({
      install: args.install,
      channel: args.channel,
      ...(args.threadTs ? { threadTs: args.threadTs } : {}),
      message,
    });
    if (result.sent === false) skipped.push({ toolName: card.toolName, reason: result.reason });
    else sent++;
  }
  return { sent, skipped };
}
