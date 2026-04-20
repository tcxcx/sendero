/**
 * Meta WhatsApp Cloud API webhook types + message envelopes.
 * Works against Meta directly (sha256= prefix on signature) or Kapso proxy
 * (bare hex signature, batched `whatsapp.message.received` envelope).
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
}

export interface WhatsAppContact {
  profile: { name: string };
  wa_id: string;
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
  | 'location';

export interface WhatsAppMessage {
  from: string;
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
  recipient_id: string;
}

/** Normalized inbound message passed to downstream handlers. */
export interface NormalizedInboundMessage {
  tenantPhoneNumberId: string;
  from: string; // E.164 normalized
  fromRaw: string; // raw Meta digits as received
  messageId: string;
  timestamp: Date;
  message: WhatsAppMessage;
}
