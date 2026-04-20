/**
 * Inbound webhook verification + payload normalization.
 *
 * Verifies HMAC-SHA256 signatures in both Meta (`x-hub-signature-256` with
 * `sha256=<hex>` prefix) and Kapso (`<hex>` bare) formats via constant-time
 * comparison. Unifies Meta native + Kapso v2 envelopes into a flat list of
 * normalized inbound messages.
 */

import crypto from 'node:crypto';
import type {
  NormalizedInboundMessage,
  WhatsAppMessage,
  WhatsAppWebhookPayload,
} from './types';
import { normalizeToE164 } from './normalize';

export function verifyWebhookSignature(
  rawBody: string,
  signature: string | null | undefined,
  appSecret: string
): boolean {
  if (!signature || !appSecret) return false;

  const expectedHex = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const receivedHex = signature.startsWith('sha256=')
    ? signature.slice('sha256='.length)
    : signature;

  const expected = Buffer.from(expectedHex, 'hex');
  const received = Buffer.from(receivedHex, 'hex');
  if (expected.length !== received.length) return false;
  return crypto.timingSafeEqual(expected, received);
}

/** Subscribe verification (GET) — Meta sends `hub.mode=subscribe&hub.challenge=…`. */
export function handleVerifyHandshake(
  searchParams: URLSearchParams,
  expectedVerifyToken: string
): { ok: true; challenge: string } | { ok: false; reason: string } {
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');
  if (mode !== 'subscribe') return { ok: false, reason: 'mode_mismatch' };
  if (token !== expectedVerifyToken) return { ok: false, reason: 'token_mismatch' };
  if (!challenge) return { ok: false, reason: 'missing_challenge' };
  return { ok: true, challenge };
}

interface KapsoV2Envelope {
  type: 'whatsapp.message.received' | string;
  data: Array<{
    message: WhatsAppMessage;
    phone_number_id: string;
  }>;
}

/**
 * Extract a flat list of inbound messages from either envelope shape.
 * Returns [] for non-message events (status updates, template events, etc.).
 */
export function normalizeWebhookPayload(
  body: WhatsAppWebhookPayload | KapsoV2Envelope,
  opts: { defaultCountry?: string } = {}
): NormalizedInboundMessage[] {
  const out: NormalizedInboundMessage[] = [];

  // Kapso v2 batched envelope
  if ('type' in body && body.type === 'whatsapp.message.received' && Array.isArray(body.data)) {
    for (const item of body.data) {
      out.push(buildNormalized(item.phone_number_id, item.message, opts.defaultCountry));
    }
    return out;
  }

  // Meta native envelope
  if ('object' in body && body.object === 'whatsapp_business_account') {
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const phoneNumberId = change.value?.metadata?.phone_number_id;
        if (!phoneNumberId) continue;
        for (const msg of change.value?.messages ?? []) {
          out.push(buildNormalized(phoneNumberId, msg, opts.defaultCountry));
        }
      }
    }
  }

  return out;
}

function buildNormalized(
  phoneNumberId: string,
  msg: WhatsAppMessage,
  defaultCountry?: string
): NormalizedInboundMessage {
  const e164 = normalizeToE164(msg.from, defaultCountry);
  return {
    tenantPhoneNumberId: phoneNumberId,
    from: e164 ?? `+${msg.from}`,
    fromRaw: msg.from,
    messageId: msg.id,
    timestamp: new Date(Number(msg.timestamp) * 1000),
    message: msg,
  };
}
