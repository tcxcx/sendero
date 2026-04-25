/**
 * Unit tests for `buildSecurityAlertSenders()` — the production wiring
 * that binds the `AlertSenders` port from `@sendero/notifications` to
 * Resend (email), `@sendero/slack` (Slack), and `@sendero/whatsapp`
 * (WhatsApp).
 *
 * These tests stub the dynamic imports via `mock.module` so we don't
 * need to install `resend` types or boot the WA Cloud API client. We
 * exercise both the success and failure paths for Slack + WhatsApp —
 * the email path is covered by the @sendero/notifications package's
 * own test suite.
 *
 * Bun's `bun:test` is the workspace test runner — same as
 * `packages/notifications/src/security-alerts.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import { buildSecurityAlertSenders } from './security-alert-senders';

// Keep snapshot of process.env so we can mutate per-test without
// leaking. Each test sets only the env it cares about.
const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  // Strip the env keys the senders read so each test starts clean.
  delete process.env.SLACK_BOT_TOKEN;
  delete process.env.WHATSAPP_ACCESS_TOKEN;
  delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  delete process.env.WHATSAPP_API_BASE_URL;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

// ──────────────────────────────────────────────────────────────────────
// Slack
// ──────────────────────────────────────────────────────────────────────

describe('sendSecurityAlertSlack', () => {
  it('returns slack_not_configured when SLACK_BOT_TOKEN is missing', async () => {
    const senders = buildSecurityAlertSenders();
    const result = await senders.sendSecurityAlertSlack('C0XYZ', 'Subject', 'Body');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('slack_not_configured');
  });

  it('returns slack_channel_missing when channelId is empty', async () => {
    process.env.SLACK_BOT_TOKEN = 'xoxb-test-token';
    const senders = buildSecurityAlertSenders();
    const result = await senders.sendSecurityAlertSlack('', 'Subject', 'Body');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('slack_channel_missing');
  });

  it('posts an attachment-wrapped Block Kit message on success', async () => {
    process.env.SLACK_BOT_TOKEN = 'xoxb-test-token';
    const postMessage = mock(async (args: Record<string, unknown>) => {
      // Echo what the sender passed so we can assert on the shape.
      return { ok: true, ts: '1234.5678', _args: args };
    });
    mock.module('@sendero/slack', () => ({
      createSlackClient: () => ({
        chat: { postMessage },
      }),
    }));

    const senders = buildSecurityAlertSenders();
    const result = await senders.sendSecurityAlertSlack(
      'C0XYZ',
      '[Sendero] Suspicious activity',
      'Body line.\nMore body.'
    );

    expect(result.ok).toBe(true);
    expect(postMessage).toHaveBeenCalledTimes(1);
    const args = postMessage.mock.calls[0]![0]!;
    expect(args.channel).toBe('C0XYZ');
    expect(args.text).toBe('[Sendero] Suspicious activity');
    // Red color stripe via legacy attachment + Block Kit blocks inside.
    const attachments = args.attachments as Array<{ color: string; blocks: unknown[] }>;
    expect(attachments).toHaveLength(1);
    expect(attachments[0]!.color).toBe('#b34b2e');
    expect(attachments[0]!.blocks).toHaveLength(2);
  });

  it('surfaces Slack ok:false errors with a slack: prefix', async () => {
    process.env.SLACK_BOT_TOKEN = 'xoxb-test-token';
    mock.module('@sendero/slack', () => ({
      createSlackClient: () => ({
        chat: {
          postMessage: async () => ({ ok: false, error: 'channel_not_found' }),
        },
      }),
    }));

    const senders = buildSecurityAlertSenders();
    const result = await senders.sendSecurityAlertSlack('C0XYZ', 'Subject', 'Body');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('slack:channel_not_found');
  });

  it('surfaces thrown WebClient errors as a normalized failure', async () => {
    process.env.SLACK_BOT_TOKEN = 'xoxb-test-token';
    mock.module('@sendero/slack', () => ({
      createSlackClient: () => ({
        chat: {
          postMessage: async () => {
            throw new Error('rate_limited:retry_after=15');
          },
        },
      }),
    }));

    const senders = buildSecurityAlertSenders();
    const result = await senders.sendSecurityAlertSlack('C0XYZ', 'Subject', 'Body');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('rate_limited');
  });
});

// ──────────────────────────────────────────────────────────────────────
// WhatsApp
// ──────────────────────────────────────────────────────────────────────

describe('sendSecurityAlertWhatsapp', () => {
  it('returns whatsapp_not_configured when access token is missing', async () => {
    const senders = buildSecurityAlertSenders();
    const result = await senders.sendSecurityAlertWhatsapp('+12025551234', 'Subject', 'Body');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('whatsapp_not_configured');
  });

  it('returns whatsapp_phone_missing when recipient is empty', async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = 'wa-test-token';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '999';
    const senders = buildSecurityAlertSenders();
    const result = await senders.sendSecurityAlertWhatsapp('', 'Subject', 'Body');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('whatsapp_phone_missing');
  });

  it('sends a free-form text via WhatsAppClient.sendText on success', async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = 'wa-test-token';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '999';
    const sendText = mock(async (to: string, message: string) => {
      void to;
      void message;
      return { messages: [{ id: 'wamid.HBgL...' }] };
    });
    mock.module('@sendero/whatsapp', () => ({
      WhatsAppClient: class {
        sendText = sendText;
      },
    }));

    const senders = buildSecurityAlertSenders();
    const result = await senders.sendSecurityAlertWhatsapp(
      '+1 (202) 555-1234',
      'Subject',
      'Body line.'
    );

    expect(result.ok).toBe(true);
    expect(sendText).toHaveBeenCalledTimes(1);
    const [to, message] = sendText.mock.calls[0]!;
    // Non-digits stripped except a leading '+'.
    expect(to).toBe('+12025551234');
    // Subject rendered as bold prefix, body follows after a blank line.
    expect(message).toContain('*Subject*');
    expect(message).toContain('Body line.');
  });

  it('returns whatsapp_no_message_id when the API response omits a wamid', async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = 'wa-test-token';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '999';
    mock.module('@sendero/whatsapp', () => ({
      WhatsAppClient: class {
        sendText = async () => ({ messages: [] });
      },
    }));

    const senders = buildSecurityAlertSenders();
    const result = await senders.sendSecurityAlertWhatsapp('+12025551234', 'Subject', 'Body');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('whatsapp_no_message_id');
  });

  it('surfaces thrown Cloud API errors verbatim (e.g. (#131047) outside 24h window)', async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = 'wa-test-token';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '999';
    mock.module('@sendero/whatsapp', () => ({
      WhatsAppClient: class {
        sendText = async () => {
          throw new Error(
            'WhatsApp API error: 400 - {"error":{"message":"(#131047) Re-engagement message"}}'
          );
        };
      },
    }));

    const senders = buildSecurityAlertSenders();
    const result = await senders.sendSecurityAlertWhatsapp('+12025551234', 'Subject', 'Body');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('(#131047)');
  });
});
