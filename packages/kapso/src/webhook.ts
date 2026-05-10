/**
 * Kapso webhook signature verification + payload parsing.
 *
 * Kapso signs deliveries with HMAC-SHA256 hex in the `x-webhook-signature`
 * header (no prefix). Meta-style `sha256=<hex>` prefix is also tolerated
 * so a tenant can point either Meta directly OR Kapso at the same route.
 *
 * Ported from desk-v1 utils (`verifyWebhookSignature`), adapted for
 * Sendero — generalised to take raw-body + header only, no framework.
 */

import crypto from 'node:crypto';
import {
  MessageReceivedEvent,
  MessageReceivedV2Event,
  PhoneNumberCreatedEvent,
  WorkflowFailedEvent,
  WorkflowHandoffEvent,
  type KapsoWhatsAppPhoneNumber,
} from './types';

export function verifyKapsoSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secret: string
): boolean {
  if (!signatureHeader || !secret) return false;
  const received = signatureHeader.startsWith('sha256=')
    ? signatureHeader.slice('sha256='.length)
    : signatureHeader;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  try {
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(received, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export interface ParsedConnectionEvent {
  kind: 'phone_number.created';
  customerId: string;
  phoneNumberId: string;
  businessAccountId?: string;
  displayPhoneNumber?: string;
  verifiedName?: string;
}

/**
 * Phase H — Kapso default `handoff_to_human` tool fired. Sendero
 * mirrors operator notifications (Liveblocks + Slack + dashboard
 * row) regardless of which escalation path the agent used.
 */
export interface ParsedWorkflowHandoffEvent {
  kind: 'workflow.execution.handoff';
  workflowId: string | null;
  executionId: string | null;
  phoneNumberId: string | null;
  customerPhone: string | null;
  reason: string | null;
  summary: string | null;
}

export interface ParsedWorkflowFailedEvent {
  kind: 'workflow.execution.failed';
  workflowId: string | null;
  executionId: string | null;
  phoneNumberId: string | null;
  customerPhone: string | null;
  errorMessage: string | null;
  errorCode: string | null;
}

/**
 * Inbound WhatsApp message from a traveler, normalised across the two
 * Kapso payload shapes (nested-under-`message` and top-level-flat).
 * `text` is null for non-text messages (image, location, etc); the
 * trip ledger logs them as `inbox_reply` with a placeholder body and
 * the original `messageType` so future handlers can branch.
 */
export interface ParsedMessageReceivedEvent {
  kind: 'whatsapp.message.received' | 'whatsapp.message.sent';
  direction: 'inbound' | 'outbound';
  phoneNumberId: string | null;
  customerId: string | null;
  customerPhone: string | null;
  conversationId: string | null;
  wamid: string | null;
  messageType: string | null;
  text: string | null;
  /** Unix seconds (Meta convention) when present. */
  timestamp: number | null;
}

export type ParsedKapsoProjectEvent =
  | ParsedConnectionEvent
  | ParsedWorkflowHandoffEvent
  | ParsedWorkflowFailedEvent
  | ParsedMessageReceivedEvent;

function timestampSeconds(raw: unknown): number | null {
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string' && /^\d+$/.test(raw)) return Number(raw);
  return null;
}

function normalizePhoneNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.startsWith('+') ? trimmed : `+${trimmed}`;
}

function parsedMessageReceivedV2(
  payload: unknown,
  envelopeType?: unknown
): ParsedMessageReceivedEvent | null {
  const msgV2 = MessageReceivedV2Event.safeParse(payload);
  if (!msgV2.success) return null;

  const data = msgV2.data;
  const m = data.message;
  if (envelopeType === 'whatsapp.message.received' && m.kapso?.direction === 'outbound') {
    return null;
  }
  const direction =
    m.kapso?.direction === 'outbound' || envelopeType === 'whatsapp.message.sent'
      ? 'outbound'
      : 'inbound';

  return {
    kind: direction === 'outbound' ? 'whatsapp.message.sent' : 'whatsapp.message.received',
    direction,
    phoneNumberId: data.phone_number_id ?? data.conversation?.phone_number_id ?? null,
    customerId: null,
    customerPhone: normalizePhoneNumber(data.conversation?.phone_number),
    conversationId: data.conversation?.id ?? null,
    wamid: m.wamid ?? m.id ?? null,
    messageType: m.type ?? null,
    text: m.text?.body ?? m.body ?? m.kapso?.content ?? null,
    timestamp: timestampSeconds(m.timestamp),
  };
}

/**
 * Parse a Kapso project-scope event payload into the events Sendero
 * cares about. Returns `null` for unrecognised event types so callers
 * can ignore cleanly without throwing.
 */
export function parseProjectEvent(payload: unknown): ParsedKapsoProjectEvent | null {
  const phoneCreated = PhoneNumberCreatedEvent.safeParse(payload);
  if (phoneCreated.success) {
    const { data } = phoneCreated.data;
    return {
      kind: 'phone_number.created',
      customerId: data.customer_id,
      phoneNumberId: data.phone_number_id,
      businessAccountId: data.business_account_id,
      displayPhoneNumber: data.display_phone_number,
      verifiedName: data.verified_name,
    };
  }
  const handoff = WorkflowHandoffEvent.safeParse(payload);
  if (handoff.success) {
    const { data } = handoff.data;
    return {
      kind: 'workflow.execution.handoff',
      workflowId: data.workflow_id ?? null,
      executionId: data.workflow_execution_id ?? data.execution_id ?? null,
      phoneNumberId: data.phone_number_id ?? null,
      customerPhone: data.customer_phone ?? data.customer_phone_number ?? null,
      reason: data.reason ?? null,
      summary: data.context_summary ?? data.summary ?? null,
    };
  }
  const failed = WorkflowFailedEvent.safeParse(payload);
  if (failed.success) {
    const { data } = failed.data;
    return {
      kind: 'workflow.execution.failed',
      workflowId: data.workflow_id ?? null,
      executionId: data.workflow_execution_id ?? data.execution_id ?? null,
      phoneNumberId: data.phone_number_id ?? null,
      customerPhone: data.customer_phone ?? data.customer_phone_number ?? null,
      errorMessage: data.error_message ?? null,
      errorCode: data.error_code ?? null,
    };
  }
  if (payload && typeof payload === 'object') {
    const record = payload as { type?: unknown; data?: unknown };
    if (record.type === 'whatsapp.message.received' || record.type === 'whatsapp.message.sent') {
      const items = Array.isArray(record.data) ? record.data : [record.data];
      for (const item of items) {
        const event = parsedMessageReceivedV2(item, record.type);
        if (event) return event;
      }
    }
  }
  const msg = MessageReceivedEvent.safeParse(payload);
  if (msg.success) {
    const { data } = msg.data;
    const m = data.message ?? {};
    const wamid = m.wamid ?? m.id ?? data.wamid ?? data.message_id ?? null;
    const text = m.text?.body ?? m.body ?? data.text?.body ?? data.body ?? null;
    return {
      kind: 'whatsapp.message.received',
      direction: 'inbound',
      phoneNumberId: data.phone_number_id ?? null,
      customerId: data.customer_id ?? null,
      customerPhone: data.customer_phone ?? data.customer_phone_number ?? null,
      conversationId: data.conversation_id ?? data.whatsapp_conversation_id ?? null,
      wamid,
      messageType: m.type ?? data.message_type ?? null,
      text,
      timestamp: timestampSeconds(m.timestamp),
    };
  }
  return parsedMessageReceivedV2(payload);
}

/**
 * Convenience: project the parsed event onto the fields Sendero persists
 * on `WhatsAppInstall`. The caller combines this with the Kapso customer
 * id (already recorded at onboarding time) to resolve the tenantId.
 *
 * Only meaningful for `phone_number.created` events.
 */
export function installFieldsFromEvent(
  event: ParsedConnectionEvent
): Pick<
  KapsoWhatsAppPhoneNumber,
  'phone_number_id' | 'business_account_id' | 'display_phone_number' | 'verified_name'
> {
  return {
    phone_number_id: event.phoneNumberId,
    business_account_id: event.businessAccountId ?? null,
    display_phone_number: event.displayPhoneNumber ?? null,
    verified_name: event.verifiedName ?? null,
  };
}
