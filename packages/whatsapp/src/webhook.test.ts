/**
 * Tests for `normalizeWebhookPayload`'s status-update extraction.
 *
 * The webhook normalizer turns Meta + Kapso envelopes into a flat list
 * of `{ messages, identityChanges, statusUpdates }`. Status updates are
 * the outbound-delivery audit signal — `sent` / `delivered` / `read` /
 * `failed` keyed on the same wamid we wrote into
 * `OtpDeliveryAttempt.providerMessageId` on dispatch.
 *
 * Run: `bun test packages/whatsapp/src/webhook.test.ts`
 */

import { describe, expect, test } from 'bun:test';

import { normalizeWebhookPayload } from './webhook';

describe('normalizeWebhookPayload — Meta envelope statuses', () => {
  test('extracts a delivered status', () => {
    const result = normalizeWebhookPayload({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'wba_1',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '+15551234567',
                  phone_number_id: 'PNID_42',
                },
                statuses: [
                  {
                    id: 'wamid.ABC',
                    status: 'delivered',
                    timestamp: '1745764800',
                    recipient_id: '+15559876543',
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(result.statusUpdates).toHaveLength(1);
    const status = result.statusUpdates[0]!;
    expect(status.messageId).toBe('wamid.ABC');
    expect(status.status).toBe('delivered');
    expect(status.tenantPhoneNumberId).toBe('PNID_42');
    expect(status.recipientId).toBe('+15559876543');
    expect(status.failureReason).toBeNull();
  });

  test('extracts a failed status with failureReason from errors[0].title', () => {
    const result = normalizeWebhookPayload({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'wba_1',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '+15551234567',
                  phone_number_id: 'PNID_42',
                },
                statuses: [
                  {
                    id: 'wamid.FAIL',
                    status: 'failed',
                    timestamp: '1745764800',
                    recipient_id: '+15559876543',
                    errors: [
                      {
                        code: 131_026,
                        title: 'Receiver is incapable of receiving this message',
                        message: 'Message undeliverable',
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(result.statusUpdates).toHaveLength(1);
    expect(result.statusUpdates[0]!.failureReason).toBe(
      'Receiver is incapable of receiving this message'
    );
  });

  test('falls back to error code when title and message missing', () => {
    const result = normalizeWebhookPayload({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'wba_1',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '+15551234567',
                  phone_number_id: 'PNID_42',
                },
                statuses: [
                  {
                    id: 'wamid.FAIL',
                    status: 'failed',
                    timestamp: '1745764800',
                    errors: [{ code: 999 }],
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(result.statusUpdates[0]!.failureReason).toBe('meta_error_999');
  });

  test('messages and statuses can coexist on one envelope', () => {
    const result = normalizeWebhookPayload({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'wba_1',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '+15551234567',
                  phone_number_id: 'PNID_42',
                },
                contacts: [
                  {
                    profile: { name: 'Alice' },
                    wa_id: '15559876543',
                  },
                ],
                messages: [
                  {
                    from: '15559876543',
                    id: 'wamid.IN',
                    timestamp: '1745764800',
                    type: 'text',
                    text: { body: 'hi' },
                  },
                ],
                statuses: [
                  {
                    id: 'wamid.OUT',
                    status: 'read',
                    timestamp: '1745764810',
                    recipient_id: '+15559876543',
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]!.messageId).toBe('wamid.IN');
    expect(result.statusUpdates).toHaveLength(1);
    expect(result.statusUpdates[0]!.messageId).toBe('wamid.OUT');
    expect(result.statusUpdates[0]!.status).toBe('read');
  });

  test('non-failed status leaves failureReason null', () => {
    const result = normalizeWebhookPayload({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'wba_1',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '+15551234567',
                  phone_number_id: 'PNID_42',
                },
                statuses: [
                  {
                    id: 'wamid.SENT',
                    status: 'sent',
                    timestamp: '1745764800',
                    recipient_id: '+15559876543',
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(result.statusUpdates[0]!.failureReason).toBeNull();
  });

  test('empty payload returns empty arrays', () => {
    const result = normalizeWebhookPayload({
      object: 'whatsapp_business_account',
      entry: [],
    });
    expect(result.messages).toEqual([]);
    expect(result.identityChanges).toEqual([]);
    expect(result.statusUpdates).toEqual([]);
  });

  test('Kapso v2 envelope returns empty statusUpdates (statuses not yet relayed)', () => {
    const result = normalizeWebhookPayload({
      type: 'whatsapp.message.received',
      data: [],
    });
    expect(result.statusUpdates).toEqual([]);
  });
});
