/**
 * WhatsApp channel renderer.
 *
 * Translates a `ChannelMessage` into a WhatsApp Cloud API send payload.
 * The traveler-side WhatsApp UI receives whatever this emits, text
 * bubble, button list, list message, or template message depending on
 * the canonical kind.
 *
 * Reference: https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages
 *
 * Kapso adapter (used in dev / hosted-WA flows) accepts the same
 * shapes via its REST proxy. See `packages/kapso/src/`.
 *
 * The `to` field on the returned payload is left as an empty string by
 * design; the caller (dispatcher / send helper) must populate the
 * traveler's E.164 number before sending. Keeping this renderer
 * recipient-agnostic lets the same payload be cached and sent to
 * multiple recipients without re-rendering.
 */

import { buildShareImageUrl } from '@/lib/og/share-url';
import type {
  ChannelCta,
  ChannelMessage,
  ChannelMessageCard,
  ChannelMessageSources,
  ChannelMessageText,
  ChannelMessageToolResult,
  ChannelRenderer,
  RenderedForChannel,
} from '../types';

/**
 * Minimal WhatsApp Cloud API send-message envelope. Real impl will
 * narrow this to the discriminated union of text / interactive /
 * template payloads.
 */
export interface WhatsAppPayload {
  messaging_product: 'whatsapp';
  recipient_type: 'individual';
  to: string;
  type: 'text' | 'interactive' | 'image' | 'template';
  text?: { body: string; preview_url?: boolean };
  interactive?: {
    type: 'button' | 'list' | 'cta_url';
    header?: { type: 'text' | 'image'; text?: string; image?: { link: string } };
    body: { text: string };
    footer?: { text: string };
    action: unknown;
  };
  image?: { link: string; caption?: string };
  template?: { name: string; language: { code: string }; components?: unknown[] };
}

const WA_BUTTON_TITLE_MAX = 20;
const WA_BODY_MAX = 1024;
const WA_LIST_BUTTON_MAX = 20;
const WA_LIST_ROWS_MAX = 10;
const MAX_BUTTONS = 3;
const MAX_SOURCES = 5;

function exhaustive(_: never): never {
  throw new Error('non-exhaustive ChannelMessage kind in renderForWhatsApp');
}

/**
 * Truncate a string to a max length, appending an ellipsis if cut.
 * Used for button titles (hard 20-char cap from Cloud API spec).
 */
function clip(input: string, max: number): string {
  if (input.length <= max) return input;
  if (max <= 3) return input.slice(0, max);
  return `${input.slice(0, max - 3)}...`;
}

/**
 * Truncate a body to a max length, preferring the last sentence
 * boundary inside the window so we cut at a period rather than mid-word.
 */
function clipBody(input: string, max: number): string {
  if (input.length <= max) return input;
  const window = input.slice(0, max - 3);
  const lastStop = Math.max(
    window.lastIndexOf('. '),
    window.lastIndexOf('! '),
    window.lastIndexOf('? ')
  );
  if (lastStop > max * 0.6) {
    return `${window.slice(0, lastStop + 1)}...`;
  }
  return `${window}...`;
}

/**
 * Convert canonical markdown to WhatsApp's mrkdwn-lite. WhatsApp does
 * not render real markdown. It supports only:
 *   *bold* (asterisks, no double),
 *   _italic_ (underscores),
 *   ~strike~ (tildes),
 *   `mono` (single backticks).
 *
 * We rewrite the common GFM tokens into WA equivalents and drop the
 * rest so the body reads cleanly when WA renders it raw.
 */
function simplifyForWhatsApp(content: string): string {
  let out = content;
  out = out.replace(/\*\*(.+?)\*\*/g, '*$1*');
  out = out.replace(/__(.+?)__/g, '*$1*');
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1_$2_');
  out = out.replace(/```[\s\S]*?```/g, match => {
    const inner = match.replace(/^```\w*\n?/, '').replace(/```$/, '');
    return inner;
  });
  out = out.replace(/^#{1,6}\s+(.+)$/gm, '*$1*');
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');
  out = out.replace(/^\s*[-*+]\s+/gm, '- ');
  out = out.replace(/\n{3,}/g, '\n\n');
  return out.trim();
}

function ctaToButtonId(cta: ChannelCta): string {
  return `${cta.kind}:${cta.value ?? ''}`;
}

function envelope(payload: WhatsAppPayload): WhatsAppPayload {
  return payload;
}

function renderText(msg: ChannelMessageText): RenderedForChannel<WhatsAppPayload> {
  const body = clipBody(simplifyForWhatsApp(msg.content), WA_BODY_MAX);
  return {
    channel: 'whatsapp',
    payload: envelope({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '',
      type: 'text',
      text: { body, preview_url: false },
    }),
  };
}

interface CardLike {
  title: string;
  body: string;
  bullets?: string[];
  imageUrl?: string;
  ctas?: ChannelCta[];
}

function buildCardBody(card: CardLike): string {
  const parts: string[] = [`*${card.title}*`, simplifyForWhatsApp(card.body)];
  if (card.bullets && card.bullets.length > 0) {
    parts.push(card.bullets.map(b => `- ${b}`).join('\n'));
  }
  return clipBody(parts.filter(Boolean).join('\n\n'), WA_BODY_MAX);
}

function renderCardLike(card: CardLike): RenderedForChannel<WhatsAppPayload> {
  const ctas = card.ctas ?? [];
  const fitsButton = ctas.length > 0 && ctas.length <= MAX_BUTTONS;
  const body = buildCardBody(card);

  // Single `open_link` CTA → WhatsApp's native `cta_url` interactive.
  // Reply buttons can't carry a URL — treating an open_link as a reply
  // would mean the traveler taps and the bot just receives a button
  // event, never opens the page. cta_url is the canonical URL-button
  // type. We only use it for the single-link case because Cloud API
  // restricts cta_url to exactly one URL action.
  const onlyOpenLink =
    ctas.length === 1 && ctas[0].kind === 'open_link' && (ctas[0].href ?? ctas[0].value);
  if (onlyOpenLink) {
    const cta = ctas[0];
    const url = (cta.href ?? cta.value ?? '').trim();
    return {
      channel: 'whatsapp',
      payload: envelope({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: '',
        type: 'interactive',
        interactive: {
          type: 'cta_url',
          header: card.imageUrl ? { type: 'image', image: { link: card.imageUrl } } : undefined,
          body: { text: body },
          action: {
            name: 'cta_url',
            parameters: {
              display_text: clip(cta.label, WA_BUTTON_TITLE_MAX),
              url,
            },
          },
        },
      }),
    };
  }

  // Mixed CTAs (e.g. open_link + reply approve) — Cloud API has no
  // hybrid interactive that mixes URL + reply, so we degrade to a text
  // bubble that includes the URL inline (with preview_url=true so the
  // link card unfurls). Keeps the link tappable; the reply CTAs are
  // expected to surface elsewhere (operator console / Slack) anyway.
  const openLinkCta = ctas.find(c => c.kind === 'open_link' && (c.href ?? c.value));
  if (openLinkCta && ctas.length > 1) {
    const url = (openLinkCta.href ?? openLinkCta.value ?? '').trim();
    const inline = `${body}\n\n${openLinkCta.label}: ${url}`;
    return {
      channel: 'whatsapp',
      payload: envelope({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: '',
        type: 'text',
        text: { body: clipBody(inline, WA_BODY_MAX), preview_url: true },
      }),
      degraded: true,
    };
  }

  if (fitsButton) {
    const buttons = ctas.slice(0, MAX_BUTTONS).map(cta => ({
      type: 'reply' as const,
      reply: { id: ctaToButtonId(cta), title: clip(cta.label, WA_BUTTON_TITLE_MAX) },
    }));
    return {
      channel: 'whatsapp',
      payload: envelope({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: '',
        type: 'interactive',
        interactive: {
          type: 'button',
          header: card.imageUrl ? { type: 'image', image: { link: card.imageUrl } } : undefined,
          body: { text: body },
          action: { buttons },
        },
      }),
    };
  }

  if (ctas.length === 0) {
    if (card.imageUrl) {
      return {
        channel: 'whatsapp',
        payload: envelope({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: '',
          type: 'image',
          image: { link: card.imageUrl, caption: body },
        }),
      };
    }
    return {
      channel: 'whatsapp',
      payload: envelope({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: '',
        type: 'text',
        text: { body, preview_url: false },
      }),
    };
  }

  const rows = ctas.slice(0, WA_LIST_ROWS_MAX).map(cta => ({
    id: ctaToButtonId(cta),
    title: clip(cta.label, WA_BUTTON_TITLE_MAX),
    description: cta.value ? clip(cta.value, 72) : undefined,
  }));

  return {
    channel: 'whatsapp',
    payload: envelope({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '',
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: body },
        action: {
          button: clip('View options', WA_LIST_BUTTON_MAX),
          sections: [{ title: clip(card.title, 24), rows }],
        },
      },
    }),
    degraded: ctas.length > WA_LIST_ROWS_MAX,
  };
}

async function renderCard(msg: ChannelMessageCard): Promise<RenderedForChannel<WhatsAppPayload>> {
  // Image precedence: explicit imageUrl wins (export_route_map static-map
  // links, restaurant photos), otherwise fall back to the canonical
  // Satori OG card so the WhatsApp interactive header carries the same
  // brand frame the operator/email/web sees.
  const imageUrl =
    msg.imageUrl ??
    (await buildShareImageUrl({
      title: msg.title,
      body: msg.body,
      bullets: msg.bullets,
      primaryCta: msg.ctas?.[0] ? { label: msg.ctas[0].label } : undefined,
    })) ??
    undefined;
  return renderCardLike({
    title: msg.title,
    body: msg.body,
    bullets: msg.bullets,
    imageUrl,
    ctas: msg.ctas,
  });
}

async function renderToolResult(
  msg: ChannelMessageToolResult
): Promise<RenderedForChannel<WhatsAppPayload> | null> {
  if (!msg.share) return null;
  const ctas = [msg.share.primaryCta, ...(msg.share.secondaryCtas ?? [])].filter(
    (c): c is ChannelCta => Boolean(c)
  );
  const imageUrl =
    msg.share.imageUrl ??
    (await buildShareImageUrl({
      title: msg.share.title,
      body: msg.share.body,
      bullets: msg.share.bullets,
      primaryCta: msg.share.primaryCta ? { label: msg.share.primaryCta.label } : undefined,
    })) ??
    undefined;
  return renderCardLike({
    title: msg.share.title,
    body: msg.share.body,
    bullets: msg.share.bullets,
    imageUrl,
    ctas,
  });
}

function renderSources(msg: ChannelMessageSources): RenderedForChannel<WhatsAppPayload> | null {
  if (!msg.items || msg.items.length === 0) return null;
  const lines = msg.items
    .slice(0, MAX_SOURCES)
    .map((item, i) => `${i + 1}. ${item.title} - ${item.url}`);
  const body = clipBody(`Sources:\n${lines.join('\n')}`, WA_BODY_MAX);
  return {
    channel: 'whatsapp',
    payload: envelope({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '',
      type: 'text',
      text: { body, preview_url: true },
    }),
  };
}

/**
 * Render a canonical ChannelMessage as a WhatsApp send payload.
 * Returns null when the canonical kind is intentionally not relayed
 * (reasoning, raw tool_invocation, operator approval cards).
 */
export const renderForWhatsApp: ChannelRenderer<WhatsAppPayload> = async (
  msg: ChannelMessage
): Promise<RenderedForChannel<WhatsAppPayload> | null> => {
  switch (msg.kind) {
    case 'text':
      return renderText(msg);
    case 'card':
      return await renderCard(msg);
    case 'tool_invocation':
      return null;
    case 'tool_result':
      return await renderToolResult(msg);
    case 'approval_request':
      return null;
    case 'reasoning':
      return null;
    case 'sources':
      return renderSources(msg);
    default:
      return exhaustive(msg);
  }
};
