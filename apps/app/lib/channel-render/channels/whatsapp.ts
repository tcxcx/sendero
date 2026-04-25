/**
 * WhatsApp channel renderer (STUB).
 *
 * Translates a `ChannelMessage` into a WhatsApp Cloud API send payload.
 * The traveler-side WhatsApp UI receives whatever this emits — text
 * bubble, button list, list message, or template message depending on
 * the canonical kind.
 *
 * Reference: https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages
 *
 * Kapso adapter (used in dev / hosted-WA flows) accepts the same
 * shapes via its REST proxy. See `packages/kapso/src/`.
 *
 * STATUS: stub interfaces only. Wire-up to the existing
 * `packages/whatsapp/src/` send helpers is a follow-up PR.
 */

import type { ChannelMessage, ChannelRenderer, RenderedForChannel } from '../types';

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
    type: 'button' | 'list';
    header?: { type: 'text' | 'image'; text?: string; image?: { link: string } };
    body: { text: string };
    footer?: { text: string };
    action: unknown;
  };
  image?: { link: string; caption?: string };
  template?: { name: string; language: { code: string }; components?: unknown[] };
}

/**
 * Render a canonical ChannelMessage as a WhatsApp send payload.
 * Returns null when the canonical kind is intentionally not relayed
 * (reasoning, raw tool_invocation).
 */
export const renderForWhatsApp: ChannelRenderer<WhatsAppPayload> = (
  msg: ChannelMessage
): RenderedForChannel<WhatsAppPayload> | null => {
  // STUB: real implementations land in a follow-up. The shape below
  // is the contract — every kind has a fallback or null exclusion.
  void msg;
  return null;
};
