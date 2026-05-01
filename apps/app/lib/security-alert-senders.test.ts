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

import { buildSecurityAlertSenders } from './security-alert-senders';
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

let whatsappSendText = mock(async (_to: string, _message: string) => ({
  messages: [{ id: 'wamid.default' }],
}));
let whatsappSendTemplate = mock(async (_args: unknown) => ({
  messages: [{ id: 'wamid.template' }],
}));
let whatsappIsOutsideSessionWindowError = (_err: unknown) => false;

mock.module('@sendero/whatsapp', () => ({
  WhatsAppClient: class {
    sendText = whatsappSendText;
    sendTemplate = whatsappSendTemplate;
  },
  SENDERO_TEMPLATES: {
    SECURITY_ALERT: { name: 'sendero_security_alert', defaultLocale: 'en_US' },
  },
  buildSecurityAlertComponents: (subject: string, body: string) => [
    { type: 'header', parameters: [{ type: 'text', text: subject }] },
    { type: 'body', parameters: [{ type: 'text', text: body }] },
  ],
  isOutsideSessionWindowError: (err: unknown) => whatsappIsOutsideSessionWindowError(err),
}));

// Keep snapshot of process.env so we can mutate per-test without
// leaking. Each test sets only the env it cares about.
const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  // Strip the env keys the senders read so each test starts clean.
  delete process.env.SLACK_BOT_TOKEN;
  delete process.env.WHATSAPP_ACCESS_TOKEN;
  delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  delete process.env.WHATSAPP_API_BASE_URL;
  mock.module('@sendero/database', () => ({
    prisma: {
      slackInstall: {
        findFirst: async () => null,
      },
    },
  }));
  whatsappSendText = mock(async (_to: string, _message: string) => ({
    messages: [{ id: 'wamid.default' }],
  }));
  whatsappSendTemplate = mock(async (_args: unknown) => ({
    messages: [{ id: 'wamid.template' }],
  }));
  whatsappIsOutsideSessionWindowError = () => false;
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
    const result = await senders.sendSecurityAlertSlack('ten_test', 'C0XYZ', 'Subject', 'Body');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('slack_not_configured');
  });

  it('returns slack_channel_missing when channelId is empty', async () => {
    process.env.SLACK_BOT_TOKEN = 'xoxb-test-token';
    const senders = buildSecurityAlertSenders();
    const result = await senders.sendSecurityAlertSlack('ten_test', '', 'Subject', 'Body');
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
      'ten_test',
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
    const result = await senders.sendSecurityAlertSlack('ten_test', 'C0XYZ', 'Subject', 'Body');
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
    const result = await senders.sendSecurityAlertSlack('ten_test', 'C0XYZ', 'Subject', 'Body');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('rate_limited');
  });

  // Per-tenant routing: when SlackInstall exists for the tenant, the
  // sender uses THAT install's botToken — NOT the env fallback. This
  // is the production property that lets alerts land in the customer's
  // own Slack workspace instead of Sendero's.
  it('prefers per-tenant SlackInstall.botToken over env SLACK_BOT_TOKEN', async () => {
    process.env.SLACK_BOT_TOKEN = 'xoxb-env-token';
    let capturedToken: string | null = null;
    mock.module('@sendero/database', () => ({
      prisma: {
        slackInstall: {
          findFirst: async () => ({ botToken: 'xoxb-tenant-token' }),
        },
      },
    }));
    mock.module('@sendero/slack', () => ({
      createSlackClient: (token: string) => {
        capturedToken = token;
        return { chat: { postMessage: async () => ({ ok: true }) } };
      },
    }));

    const senders = buildSecurityAlertSenders();
    const result = await senders.sendSecurityAlertSlack('ten_test', 'C0XYZ', 'Subject', 'Body');
    expect(result.ok).toBe(true);
    // Per-tenant token wins; env value is the fallback for single-tenant deploys only.
    expect(capturedToken).toBe('xoxb-tenant-token');
  });

  it('falls back to env SLACK_BOT_TOKEN when no SlackInstall exists for the tenant', async () => {
    process.env.SLACK_BOT_TOKEN = 'xoxb-env-token';
    let capturedToken: string | null = null;
    mock.module('@sendero/database', () => ({
      prisma: {
        slackInstall: {
          findFirst: async () => null,
        },
      },
    }));
    mock.module('@sendero/slack', () => ({
      createSlackClient: (token: string) => {
        capturedToken = token;
        return { chat: { postMessage: async () => ({ ok: true }) } };
      },
    }));

    const senders = buildSecurityAlertSenders();
    const result = await senders.sendSecurityAlertSlack(
      'ten_no_install',
      'C0XYZ',
      'Subject',
      'Body'
    );
    expect(result.ok).toBe(true);
    expect(capturedToken).toBe('xoxb-env-token');
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
    whatsappSendText = mock(async (to: string, message: string) => {
      void to;
      void message;
      return { messages: [{ id: 'wamid.HBgL...' }] };
    });

    const senders = buildSecurityAlertSenders();
    const result = await senders.sendSecurityAlertWhatsapp(
      '+1 (202) 555-1234',
      'Subject',
      'Body line.'
    );

    expect(result.ok).toBe(true);
    expect(whatsappSendText).toHaveBeenCalledTimes(1);
    const [to, message] = whatsappSendText.mock.calls[0]!;
    // Non-digits stripped except a leading '+'.
    expect(to).toBe('+12025551234');
    // Subject rendered as bold prefix, body follows after a blank line.
    expect(message).toContain('*Subject*');
    expect(message).toContain('Body line.');
  });

  it('returns whatsapp_no_message_id when the API response omits a wamid', async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = 'wa-test-token';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '999';
    whatsappSendText = mock(async () => ({ messages: [] }));

    const senders = buildSecurityAlertSenders();
    const result = await senders.sendSecurityAlertWhatsapp('+12025551234', 'Subject', 'Body');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('whatsapp_no_message_id');
  });

  it('falls back to the security alert template when free-form text is outside the 24h window', async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = 'wa-test-token';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '999';
    whatsappSendText = mock(async () => {
      throw new Error(
        'WhatsApp API error: 400 - {"error":{"message":"(#131047) Re-engagement message"}}'
      );
    });
    whatsappSendTemplate = mock(async () => ({ messages: [{ id: 'wamid.template' }] }));
    whatsappIsOutsideSessionWindowError = (err: unknown) =>
      err instanceof Error && err.message.includes('(#131047)');

    const senders = buildSecurityAlertSenders();
    const result = await senders.sendSecurityAlertWhatsapp('+12025551234', 'Subject', 'Body');
    expect(result.ok).toBe(true);
    expect(whatsappSendTemplate).toHaveBeenCalledTimes(1);
  });
});
