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
import { PhoneNumberCreatedEvent, type KapsoWhatsAppPhoneNumber } from './types';

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
 * Parse a Kapso project-scope event payload into the connection events
 * Sendero cares about. Returns `null` for unrecognised event types so
 * callers can ignore cleanly without throwing.
 */
export function parseProjectEvent(payload: unknown): ParsedConnectionEvent | null {
  const parsed = PhoneNumberCreatedEvent.safeParse(payload);
  if (!parsed.success) return null;
  const { data } = parsed.data;
  return {
    kind: 'phone_number.created',
    customerId: data.customer_id,
    phoneNumberId: data.phone_number_id,
    businessAccountId: data.business_account_id,
    displayPhoneNumber: data.display_phone_number,
    verifiedName: data.verified_name,
  };
}

/**
 * Convenience: project the parsed event onto the fields Sendero persists
 * on `WhatsAppInstall`. The caller combines this with the Kapso customer
 * id (already recorded at onboarding time) to resolve the tenantId.
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
