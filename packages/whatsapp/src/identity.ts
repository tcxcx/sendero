/**
 * WhatsApp identity helpers.
 *
 * Per Meta's BSUID rollout (April 2026), `business_scoped_user_id` is the
 * preferred primary key. Phone numbers / wa_id can be absent on
 * username-adopter payloads. This module:
 *   - Builds a unified WhatsAppIdentity lens from either a contact or a
 *     message (both envelopes are supported).
 *   - Exposes `identityKey()` which returns the correct match key for
 *     storage / lookup in the order: BSUID → wa_id/phone → username.
 *   - Merges two identities when one is a BSUID-only payload and the
 *     other carries phone — used to keep a single logical traveler after
 *     a user_id_update event.
 *
 * Outbound sending stays phone-based for now; that's not in scope here.
 */

import { normalizeToE164 } from './normalize';
import type {
  NormalizedIdentityChange,
  WhatsAppContact,
  WhatsAppIdentity,
  WhatsAppMessage,
  WhatsAppUserIdUpdate,
} from './types';

const EMPTY_IDENTITY: WhatsAppIdentity = {
  phone: null,
  phoneRaw: null,
  businessScopedUserId: null,
  parentBusinessScopedUserId: null,
  username: null,
};

export function identityFromContact(
  contact: WhatsAppContact | undefined,
  defaultCountry?: string
): WhatsAppIdentity {
  if (!contact) return { ...EMPTY_IDENTITY };
  const phoneRaw = contact.wa_id?.trim() || null;
  return {
    phone: phoneRaw ? (normalizeToE164(phoneRaw, defaultCountry) ?? `+${phoneRaw}`) : null,
    phoneRaw,
    businessScopedUserId: contact.business_scoped_user_id?.trim() || null,
    parentBusinessScopedUserId: contact.parent_business_scoped_user_id?.trim() || null,
    username: contact.username?.trim() || null,
  };
}

export function identityFromMessage(
  message: WhatsAppMessage,
  defaultCountry?: string
): WhatsAppIdentity {
  const phoneRaw = message.from?.trim() || null;
  return {
    phone: phoneRaw ? (normalizeToE164(phoneRaw, defaultCountry) ?? `+${phoneRaw}`) : null,
    phoneRaw,
    businessScopedUserId: message.from_user_id?.trim() || null,
    parentBusinessScopedUserId: message.from_parent_user_id?.trim() || null,
    username: message.username?.trim() || null,
  };
}

/**
 * Return the recommended primary key for matching a WhatsApp identity
 * against your own storage. Prefer BSUID; fall back to phone; fall back
 * to username only as a last resort (not stable).
 */
export function identityKey(id: WhatsAppIdentity): string | null {
  return id.businessScopedUserId ?? id.phone ?? id.phoneRaw ?? id.username ?? null;
}

/** True if both signals can be resolved to the same logical user. */
export function sameIdentity(a: WhatsAppIdentity, b: WhatsAppIdentity): boolean {
  if (a.businessScopedUserId && b.businessScopedUserId) {
    return a.businessScopedUserId === b.businessScopedUserId;
  }
  if (a.phone && b.phone) return a.phone === b.phone;
  if (a.phoneRaw && b.phoneRaw) return a.phoneRaw === b.phoneRaw;
  // Username alone is not reliable enough to match.
  return false;
}

/**
 * Merge two identity signals for the same logical user. Non-null fields
 * on `incoming` overwrite `existing`; null/empty fields fall through.
 * Useful after a user_id_update where one payload has the new BSUID and
 * the existing record has the phone.
 */
export function mergeIdentity(
  existing: WhatsAppIdentity,
  incoming: WhatsAppIdentity
): WhatsAppIdentity {
  return {
    phone: incoming.phone ?? existing.phone,
    phoneRaw: incoming.phoneRaw ?? existing.phoneRaw,
    businessScopedUserId: incoming.businessScopedUserId ?? existing.businessScopedUserId,
    parentBusinessScopedUserId:
      incoming.parentBusinessScopedUserId ?? existing.parentBusinessScopedUserId,
    username: incoming.username ?? existing.username,
  };
}

/**
 * Extract a normalized identity-change event from a Meta `user_id_update`
 * entry. Callers (the webhook layer) iterate the `value.user_id_update`
 * array and feed each entry through this helper to get `previous` and
 * `current` identities ready to merge into their user/contact store.
 */
export function normalizeUserIdUpdate(
  tenantPhoneNumberId: string,
  update: WhatsAppUserIdUpdate,
  defaultCountry?: string
): NormalizedIdentityChange {
  const previous: WhatsAppIdentity = {
    ...EMPTY_IDENTITY,
    phoneRaw: update.old_wa_id?.trim() || null,
    phone: update.old_wa_id
      ? (normalizeToE164(update.old_wa_id, defaultCountry) ?? `+${update.old_wa_id}`)
      : null,
    businessScopedUserId: update.old_user_id?.trim() || null,
  };
  const current: WhatsAppIdentity = {
    ...EMPTY_IDENTITY,
    phoneRaw: update.new_wa_id?.trim() || null,
    phone: update.new_wa_id
      ? (normalizeToE164(update.new_wa_id, defaultCountry) ?? `+${update.new_wa_id}`)
      : null,
    businessScopedUserId: update.new_user_id?.trim() || null,
  };
  return {
    tenantPhoneNumberId,
    previous,
    current,
    reason: 'user_id_update',
    timestamp: update.timestamp ? new Date(update.timestamp) : new Date(),
  };
}

/**
 * A `user_changed_user_id` Meta system-message arrives embedded in the
 * `messages[]` array as a `type: 'system'` entry. Translate it into the
 * same normalized shape as `user_id_update` so downstream handlers don't
 * care which envelope carried it.
 */
export function normalizeSystemIdentityChange(
  tenantPhoneNumberId: string,
  message: WhatsAppMessage,
  defaultCountry?: string
): NormalizedIdentityChange | null {
  const sys = message.system;
  if (!sys || sys.type !== 'user_changed_user_id') return null;

  const previous: WhatsAppIdentity = {
    ...EMPTY_IDENTITY,
    phoneRaw: sys.wa_id?.trim() || null,
    phone: sys.wa_id ? (normalizeToE164(sys.wa_id, defaultCountry) ?? `+${sys.wa_id}`) : null,
    businessScopedUserId: sys.old_user_id?.trim() || null,
  };
  const current: WhatsAppIdentity = {
    ...EMPTY_IDENTITY,
    phoneRaw: sys.new_wa_id?.trim() || sys.wa_id?.trim() || null,
    phone:
      (sys.new_wa_id ?? sys.wa_id)
        ? (normalizeToE164((sys.new_wa_id ?? sys.wa_id) as string, defaultCountry) ??
          `+${sys.new_wa_id ?? sys.wa_id}`)
        : null,
    businessScopedUserId: sys.new_user_id?.trim() || null,
  };
  return {
    tenantPhoneNumberId,
    previous,
    current,
    reason: 'user_changed_user_id',
    timestamp: new Date(Number(message.timestamp) * 1000),
  };
}
