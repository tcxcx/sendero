/**
 * Web traveler channel renderer.
 *
 * Translates a `ChannelMessage` into the JSON shape the traveler-facing
 * web bubble UI consumes. The Sendero web traveler view (when one
 * exists at /trip/[id] or similar) reads this payload and mounts the
 * corresponding bubble component.
 *
 * Distinct from the operator renderer: the operator console uses AI
 * Elements and renders TSX directly; the web traveler view is a
 * separate surface that mounts plain bubbles (text, image, card,
 * action-button-row) without the operator-only primitives like
 * Reasoning or raw ToolInvocation.
 */

import type {
  ChannelAuthor,
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
 * Plain JSON the web traveler bubble layer mounts. Keep this loose,
 * it is the contract the traveler view expects, not the wire format
 * of any external API.
 */
export interface WebTravelerPayload {
  bubble: 'text' | 'card' | 'image' | 'actions' | 'sources';
  /** Author metadata for the bubble header. */
  author: {
    role: 'agent' | 'operator' | 'system';
    name?: string;
    avatarUrl?: string;
  };
  /** Bubble content; shape narrows by `bubble` discriminant downstream. */
  content: unknown;
  /** ISO timestamp for traveler's local-tz formatting. */
  createdAt: string;
}

function exhaustive(_: never): never {
  throw new Error('non-exhaustive ChannelMessage kind in renderForWeb');
}

/**
 * Map canonical author to web-traveler-side author. Returns null for
 * `traveler` since the traveler view does not echo the user's own
 * messages back as bubbles, the operator-side renderer handles that.
 */
function mapAuthor(author: ChannelAuthor): WebTravelerPayload['author'] | null {
  if (author.role === 'traveler') return null;
  return {
    role: author.role,
    name: author.name,
    avatarUrl: author.avatarUrl,
  };
}

interface WebCardContent {
  title: string;
  body: string;
  bullets?: string[];
  imageUrl?: string;
  ctas?: ChannelCta[];
}

interface WebSourcesContent {
  items: Array<{
    title: string;
    url: string;
    snippet?: string;
    faviconUrl?: string;
  }>;
}

interface WebTextContent {
  markdown: string;
}

function renderText(
  msg: ChannelMessageText,
  author: WebTravelerPayload['author']
): RenderedForChannel<WebTravelerPayload> {
  const content: WebTextContent = { markdown: msg.content };
  return {
    channel: 'web',
    payload: { bubble: 'text', author, content, createdAt: msg.createdAt },
  };
}

function renderCard(
  msg: ChannelMessageCard,
  author: WebTravelerPayload['author']
): RenderedForChannel<WebTravelerPayload> {
  const content: WebCardContent = {
    title: msg.title,
    body: msg.body,
    bullets: msg.bullets,
    imageUrl: msg.imageUrl,
    ctas: msg.ctas,
  };
  return {
    channel: 'web',
    payload: { bubble: 'card', author, content, createdAt: msg.createdAt },
  };
}

function renderToolResult(
  msg: ChannelMessageToolResult,
  author: WebTravelerPayload['author']
): RenderedForChannel<WebTravelerPayload> | null {
  if (!msg.share) return null;
  const ctas = [msg.share.primaryCta, ...(msg.share.secondaryCtas ?? [])].filter(
    (c): c is ChannelCta => Boolean(c)
  );
  const content: WebCardContent = {
    title: msg.share.title,
    body: msg.share.body,
    bullets: msg.share.bullets,
    imageUrl: msg.share.imageUrl,
    ctas: ctas.length > 0 ? ctas : undefined,
  };
  return {
    channel: 'web',
    payload: { bubble: 'card', author, content, createdAt: msg.createdAt },
  };
}

function renderSources(
  msg: ChannelMessageSources,
  author: WebTravelerPayload['author']
): RenderedForChannel<WebTravelerPayload> | null {
  if (!msg.items || msg.items.length === 0) return null;
  const content: WebSourcesContent = { items: msg.items };
  return {
    channel: 'web',
    payload: { bubble: 'sources', author, content, createdAt: msg.createdAt },
  };
}

export const renderForWeb: ChannelRenderer<WebTravelerPayload> = (
  msg: ChannelMessage
): RenderedForChannel<WebTravelerPayload> | null => {
  const author = mapAuthor(msg.author);
  if (!author) return null;

  switch (msg.kind) {
    case 'text':
      return renderText(msg, author);
    case 'card':
      return renderCard(msg, author);
    case 'tool_invocation':
      return null;
    case 'tool_result':
      return renderToolResult(msg, author);
    case 'approval_request':
      return null;
    case 'reasoning':
      return null;
    case 'sources':
      return renderSources(msg, author);
    default:
      return exhaustive(msg);
  }
};
