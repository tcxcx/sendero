/**
 * Inbound webhook verification + payload normalization.
 *
 * Verifies HMAC-SHA256 signatures in both Meta (`x-hub-signature-256` with
 * `sha256=<hex>` prefix) and Kapso (`<hex>` bare) formats via constant-time
 * comparison. Unifies Meta native + Kapso v2 envelopes into flat lists of
 * normalized messages AND identity-change events (BSUID migration, April
 * 2026).
 */

import crypto from 'node:crypto';
import type {
  NormalizedIdentityChange,
  NormalizedInboundMessage,
  WhatsAppMessage,
  WhatsAppStatus,
  WhatsAppWebhookPayload,
} from './types';
import {
  identityFromContact,
  identityFromMessage,
  normalizeSystemIdentityChange,
  normalizeUserIdUpdate,
} from './identity';

/**
 * Per-message delivery status update extracted from Meta's `statuses[]`
 * (or Kapso v2's `whatsapp.message.status` envelope, when surfaced).
 *
 * `messageId` is Meta's wamid — the same identifier used as
 * `providerMessageId` on rows we wrote outbound (e.g.
 * `OtpDeliveryAttempt.providerMessageId`). Joining the two closes the
 * outbound-message audit loop.
 */
export interface NormalizedStatusUpdate {
  /** Meta wamid the status applies to. */
  messageId: string;
  /** `sent` | `delivered` | `read` | `failed` per Meta. Pass-through. */
  status: string;
  /** ISO timestamp of the status event. */
  timestamp: Date;
  /** Phone-number-id the status was reported against (tenant scoping). */
  tenantPhoneNumberId: string;
  /** Recipient identifier — phone (`recipient_id`) or BSUID (`recipient_user_id`). */
  recipientId: string | null;
  /**
   * Compact failure reason for `status === 'failed'`. Picks the first
   * error envelope's `title` (falls back to `code`/`message`). `null`
   * for non-failed statuses.
   */
  failureReason: string | null;
}

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
    contact?: {
      profile: { name: string };
      wa_id?: string | null;
      business_scoped_user_id?: string | null;
      parent_business_scoped_user_id?: string | null;
      username?: string | null;
    };
  }>;
}

export interface NormalizedWebhook {
  messages: NormalizedInboundMessage[];
  identityChanges: NormalizedIdentityChange[];
  statusUpdates: NormalizedStatusUpdate[];
}

function normalizeStatus(status: WhatsAppStatus, phoneNumberId: string): NormalizedStatusUpdate {
  let failureReason: string | null = null;
  if (status.status === 'failed' && status.errors && status.errors.length > 0) {
    const e = status.errors[0]!;
    failureReason = e.title ?? e.message ?? (e.code != null ? `meta_error_${e.code}` : 'unknown');
  }
  return {
    messageId: status.id,
    status: status.status,
    timestamp: new Date(Number(status.timestamp) * 1000),
    tenantPhoneNumberId: phoneNumberId,
    recipientId: status.recipient_id ?? status.recipient_user_id ?? null,
    failureReason,
  };
}

/**
 * Extract a flat list of inbound messages AND identity-change events from
 * either envelope shape. Returns empty arrays for pure status payloads.
 *
 * Downstream handlers should apply identity changes BEFORE processing
 * messages so per-traveler state is reconciled first.
 */
export function normalizeWebhookPayload(
  body: WhatsAppWebhookPayload | KapsoV2Envelope,
  opts: { defaultCountry?: string } = {}
): NormalizedWebhook {
  const messages: NormalizedInboundMessage[] = [];
  const identityChanges: NormalizedIdentityChange[] = [];
  const statusUpdates: NormalizedStatusUpdate[] = [];

  // Kapso v2 batched envelope
  if ('type' in body && body.type === 'whatsapp.message.received' && Array.isArray(body.data)) {
    for (const item of body.data) {
      // Prefer contact-derived identity when the envelope carries it
      // (Kapso enriches contacts with BSUID before forwarding).
      const identity = item.contact
        ? identityFromContact(item.contact, opts.defaultCountry)
        : identityFromMessage(item.message, opts.defaultCountry);

      const systemChange = normalizeSystemIdentityChange(
        item.phone_number_id,
        item.message,
        opts.defaultCountry
      );
      if (systemChange) {
        identityChanges.push(systemChange);
        continue; // identity-change system messages don't double as user content
      }

      messages.push({
        tenantPhoneNumberId: item.phone_number_id,
        identity,
        messageId: item.message.id,
        timestamp: new Date(Number(item.message.timestamp) * 1000),
        message: item.message,
      });
    }
    return { messages, identityChanges, statusUpdates };
  }

  // Meta native envelope
  if ('object' in body && body.object === 'whatsapp_business_account') {
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const phoneNumberId = change.value?.metadata?.phone_number_id;
        if (!phoneNumberId) continue;

        for (const update of change.value?.user_id_update ?? []) {
          identityChanges.push(normalizeUserIdUpdate(phoneNumberId, update, opts.defaultCountry));
        }

        for (const status of change.value?.statuses ?? []) {
          statusUpdates.push(normalizeStatus(status, phoneNumberId));
        }

        // Build a phone-number → contact index so we can upgrade
        // message identity with BSUID when both arrive together.
        const contactsByWaId = new Map<string, (typeof change.value.contacts)[number]>();
        for (const contact of change.value?.contacts ?? []) {
          if (contact.wa_id) contactsByWaId.set(contact.wa_id, contact);
        }

        for (const msg of change.value?.messages ?? []) {
          const systemChange = normalizeSystemIdentityChange(
            phoneNumberId,
            msg,
            opts.defaultCountry
          );
          if (systemChange) {
            identityChanges.push(systemChange);
            continue;
          }

          const contact = msg.from ? contactsByWaId.get(msg.from) : undefined;
          const identity = contact
            ? identityFromContact(contact, opts.defaultCountry)
            : identityFromMessage(msg, opts.defaultCountry);

          messages.push({
            tenantPhoneNumberId: phoneNumberId,
            identity,
            messageId: msg.id,
            timestamp: new Date(Number(msg.timestamp) * 1000),
            message: msg,
          });
        }
      }
    }
  }

  return { messages, identityChanges, statusUpdates };
}
