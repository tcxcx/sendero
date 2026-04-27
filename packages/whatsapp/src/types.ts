/**
 * Meta WhatsApp Cloud API webhook types + message envelopes.
 *
 * Works against Meta directly and Kapso proxy (batched
 * `whatsapp.message.received` envelope).
 *
 * ## BSUID migration (Meta — April 2026)
 *
 * Meta is rolling out business-scoped user IDs (BSUIDs) as a primary
 * identity. Phone numbers can now be absent on username-adopter payloads.
 * All identity fields here are optional; the `WhatsAppIdentity` type
 * exposes a unified accessor. Matching order downstream:
 *   1) business_scoped_user_id
 *   2) wa_id / phone_number
 *   3) username (display / reconciliation only, never primary key)
 */

export interface WhatsAppWebhookPayload {
  object: string;
  entry: WhatsAppEntry[];
}

export interface WhatsAppEntry {
  id: string;
  changes: WhatsAppChange[];
}

export interface WhatsAppChange {
  value: WhatsAppValue;
  field: string;
}

export interface WhatsAppValue {
  messaging_product: string;
  metadata: {
    display_phone_number: string;
    phone_number_id: string;
  };
  contacts?: WhatsAppContact[];
  messages?: WhatsAppMessage[];
  statuses?: WhatsAppStatus[];
  /** Raw Meta BSUID identity-change signals (see handleIdentityChange). */
  user_id_update?: WhatsAppUserIdUpdate[];
}

export interface WhatsAppContact {
  profile: { name: string };
  /** May be null once the user adopts a username-only identity. */
  wa_id?: string | null;
  business_scoped_user_id?: string | null;
  parent_business_scoped_user_id?: string | null;
  username?: string | null;
}

export type WhatsAppMessageType =
  | 'text'
  | 'image'
  | 'document'
  | 'interactive'
  | 'audio'
  | 'video'
  | 'reaction'
  | 'button'
  | 'location'
  | 'system'
  | 'unknown';

export interface WhatsAppMessage {
  /** Phone-based sender id. May be null/empty on BSUID-only inbound. */
  from?: string | null;
  /** Meta BSUID (from the `from_user_id` field on Meta-style payloads). */
  from_user_id?: string | null;
  /** Parent BSUID for linked portfolios. */
  from_parent_user_id?: string | null;
  /** Recipient BSUID — for outbound-echo payloads. */
  to_user_id?: string | null;
  to_parent_user_id?: string | null;
  username?: string | null;
  id: string;
  timestamp: string;
  type: WhatsAppMessageType;
  text?: { body: string };
  image?: WhatsAppMedia;
  document?: WhatsAppMedia;
  audio?: WhatsAppMedia;
  video?: WhatsAppMedia;
  interactive?: {
    type: string;
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string; description?: string };
  };
  button?: { text: string; payload: string };
  /** Meta system-message payload, used for `user_changed_user_id`. */
  system?: {
    type: string;
    body?: string;
    customer?: string;
    wa_id?: string;
    new_wa_id?: string;
    old_user_id?: string;
    new_user_id?: string;
  };
}

export interface WhatsAppMedia {
  id: string;
  mime_type: string;
  sha256?: string;
  filename?: string;
  caption?: string;
}

export interface WhatsAppStatus {
  id: string;
  status: string;
  timestamp: string;
  /** May be null on BSUID-targeted recipients. */
  recipient_id?: string | null;
  /** Populated on BSUID recipient statuses. */
  recipient_user_id?: string | null;
  /** Populated on `failed` statuses — Meta error envelope. */
  errors?: Array<{
    code?: number;
    title?: string;
    message?: string;
    error_data?: { details?: string };
  }>;
}

/**
 * Raw Meta BSUID identity-change signal. Kapso reconciles internally,
 * but apps keeping their own identity store must mirror these.
 */
export interface WhatsAppUserIdUpdate {
  old_wa_id?: string | null;
  new_wa_id?: string | null;
  old_user_id?: string | null;
  new_user_id?: string | null;
  /** ISO-ish string as Meta emits. */
  timestamp?: string;
}

/**
 * Unified identity lens. Populate from either a contact or a message —
 * fields mirror Kapso + Meta-style keys.
 */
export interface WhatsAppIdentity {
  /** E.164 string when we were able to derive one, else null. */
  phone: string | null;
  /** Raw phone digits as Meta delivered them, or null. */
  phoneRaw: string | null;
  /** Primary BSUID identity key — preferred when present. */
  businessScopedUserId: string | null;
  parentBusinessScopedUserId: string | null;
  username: string | null;
}

/** Normalized inbound message passed to downstream handlers. */
export interface NormalizedInboundMessage {
  tenantPhoneNumberId: string;
  /** Unified identity of the sender. Key downstream lookups off `.id()`. */
  identity: WhatsAppIdentity;
  messageId: string;
  timestamp: Date;
  message: WhatsAppMessage;
}

/** Payload for an identity reconciliation event emitted alongside inbound. */
export interface NormalizedIdentityChange {
  tenantPhoneNumberId: string;
  /** Previous identity signal — at least one of phoneRaw / businessScopedUserId. */
  previous: WhatsAppIdentity;
  /** New identity the user has moved to. */
  current: WhatsAppIdentity;
  reason: 'user_id_update' | 'user_changed_user_id';
  timestamp: Date;
}
