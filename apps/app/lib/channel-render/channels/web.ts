/**
 * Web traveler channel renderer (STUB).
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
 *
 * STATUS: stub interfaces only.
 */

import type { ChannelMessage, ChannelRenderer, RenderedForChannel } from '../types';

/**
 * Plain JSON the web traveler bubble layer mounts. Keep this loose —
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

export const renderForWeb: ChannelRenderer<WebTravelerPayload> = (
  msg: ChannelMessage
): RenderedForChannel<WebTravelerPayload> | null => {
  void msg;
  return null;
};
