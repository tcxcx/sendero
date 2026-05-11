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

export type ParsedKapsoProjectEvent =
  | ParsedConnectionEvent
  | ParsedWorkflowHandoffEvent
  | ParsedWorkflowFailedEvent;

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
  return null;
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
