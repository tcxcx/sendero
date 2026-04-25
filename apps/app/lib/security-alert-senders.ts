/**
 * Production wiring for the `AlertSenders` port defined in
 * `@sendero/notifications/security-alerts`. Bound to:
 *   - Resend  → email
 *   - @sendero/slack helpers → Slack post into the configured channel
 *   - @sendero/whatsapp → WhatsApp text via Kapso/Cloud API
 *
 * Each sender catches its own provider errors and returns a typed
 * `AlertSendResult`. The handler in `@sendero/notifications` already
 * uses Promise.allSettled-equivalent semantics, but this layer
 * normalizes provider quirks (Resend's `result.error` shape, Slack's
 * channel-not-found, etc.) so the audit-row payload stays useful.
 */

import type { AlertSenders, AlertSendResult } from '@sendero/notifications/security-alerts';

/**
 * Resend lives in `@sendero/notifications`. We call it via dynamic
 * import so this file stays buildable in environments where the
 * notifications package isn't installed (e.g., a stripped indexer
 * runtime that imports this module accidentally). Cold-import cost
 * runs once per process — Node caches the resolution.
 */
async function sendEmail(to: string, subject: string, body: string): Promise<AlertSendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.SENDERO_EMAIL_FROM ?? null;
  const replyTo = process.env.SENDERO_EMAIL_REPLY_TO ?? from ?? undefined;
  if (!apiKey || !from) {
    return { ok: false, error: 'email_not_configured' };
  }
  try {
    // `resend` is a transitive dep via `@sendero/notifications`. We
    // import it dynamically so this module is buildable when the
    // package isn't on the classpath. tsc can't see the types
    // without adding `resend` to apps/app/package.json — the runtime
    // works regardless because Next bundles transitives.
    // @ts-expect-error -- transitive dep, no direct types in this app
    const { Resend } = await import('resend');
    const client = new Resend(apiKey);
    const result = await client.emails.send({
      from,
      to: [to],
      replyTo: replyTo ? [replyTo] : undefined,
      subject,
      // The `security-alerts` template is plain text by design — keep
      // it to a single channel-agnostic body so Slack + WhatsApp +
      // email render the same content. HTML rendering can layer in
      // later without changing the upstream handler shape.
      text: body,
      tags: [{ name: 'surface', value: 'security_alert' }],
    });
    if (result.error) {
      return { ok: false, error: result.error.message ?? String(result.error) };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Slack sender — posts the alert as a Block Kit message with a red
 * attachment color stripe (Slack's legacy `attachments[].color` is the
 * only way to render a left-edge color bar; new Block Kit doesn't
 * expose colored borders). The headline lives in the section block
 * (rendered as a Slack header) and the prose body sits beneath it.
 *
 * Token resolution:
 *   - Reads `SLACK_BOT_TOKEN` from env (matches the ops-alert pattern in
 *     `@sendero/slack/alerts`). For per-tenant routing we'd need to
 *     extend the `AlertSenders` port shape with a `tenantId` arg and
 *     resolve the bot token via `prisma.slackInstall.findFirst({ tenantId })`.
 *     Tracked as a follow-up — see TODO below.
 *   - The buyer-tenant must have the Sendero Slack app installed in
 *     the workspace whose `notificationSlackChannelId` is configured,
 *     OR the env-level bot must be in that workspace. Operator wins
 *     for ops-broadcast use cases; per-tenant works only when the env
 *     bot is the one installed (i.e. the development case + Sendero's
 *     own workspace).
 *
 * TODO(security-alerts-slack-per-tenant): once the alerts port grows
 * a tenantId arg, swap to `prisma.slackInstall.findFirst({ tenantId })`
 * and use that install's `botToken` instead of the env token.
 */
async function sendSlack(
  channelId: string,
  subject: string,
  body: string
): Promise<AlertSendResult> {
  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!botToken) {
    return { ok: false, error: 'slack_not_configured' };
  }
  if (!channelId) {
    return { ok: false, error: 'slack_channel_missing' };
  }
  try {
    const { createSlackClient } = await import('@sendero/slack');
    const client = createSlackClient(botToken);
    // Use a legacy attachment for the red color stripe + Block Kit
    // blocks for the structured headline/body. Slack still honors the
    // `attachments[].color` hex for the left-border accent.
    const result = await client.chat.postMessage({
      channel: channelId,
      // Fallback text rendered in notifications + by clients that don't
      // support Block Kit (e.g. mobile push previews).
      text: subject,
      attachments: [
        {
          color: '#b34b2e', // sendero red — matches email + brand
          blocks: [
            {
              type: 'header',
              text: { type: 'plain_text', text: subject, emoji: true },
            },
            {
              type: 'section',
              text: { type: 'mrkdwn', text: body },
            },
          ],
        },
      ],
    });
    if (!result.ok) {
      // Slack returns ok:false with an `error` string for known failures
      // (channel_not_found, not_in_channel, invalid_auth). Surface it
      // directly into the audit row.
      const err = (result as { error?: string }).error ?? 'slack_unknown_error';
      return { ok: false, error: `slack:${err}` };
    }
    return { ok: true };
  } catch (err) {
    // Network errors, rate limits, malformed responses. Slack's
    // WebClient throws `WebAPIPlatformError` (and friends) — we don't
    // need the type to render the message.
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * WhatsApp sender — posts a free-form text via the WABA Cloud API
 * (or Kapso proxy when `WHATSAPP_API_BASE_URL` points at one).
 *
 * **Meta 24-hour rule:** free-form messages (`type: 'text'`) only
 * work when the recipient has messaged the business within the past
 * 24 hours. Outside that window Meta requires a pre-approved HSM
 * template (see `packages/whatsapp/src/templates.ts → SENDERO_TEMPLATES`).
 * For lockout alerts we expect the buyer to be in-session via the
 * Sendero agent thread, so free-form is the right default. If you see
 * `(#131047)` errors in production, register a `sendero_security_alert`
 * template in the WABA and use `client.sendTemplate(...)` here.
 *
 * TODO(security-alerts-whatsapp-template): register a
 * `sendero_security_alert` HSM template (subject = header var, body =
 * body var) and prefer it over free-form. Free-form stays as the
 * fallback for the in-session 24-hour window.
 */
async function sendWhatsapp(
  phoneE164: string,
  subject: string,
  body: string
): Promise<AlertSendResult> {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const apiBaseUrl = process.env.WHATSAPP_API_BASE_URL;
  if (!accessToken || !phoneNumberId) {
    return { ok: false, error: 'whatsapp_not_configured' };
  }
  if (!phoneE164) {
    return { ok: false, error: 'whatsapp_phone_missing' };
  }
  try {
    const { WhatsAppClient } = await import('@sendero/whatsapp');
    const client = new WhatsAppClient({
      phoneNumberId,
      accessToken,
      ...(apiBaseUrl ? { apiBaseUrl } : {}),
    });
    // Strip the leading '+' if present — Cloud API accepts both, but
    // some upstream proxies normalize to digits-only. Keep digits +
    // optional leading '+' to match the existing whatsapp/webhook path.
    const to = phoneE164.replace(/[^\d+]/g, '');
    // Free-form text. Subject becomes the first line; body follows
    // after a blank line so screen readers + WA clients render the
    // hierarchy. WA itself doesn't support Markdown headers in
    // free-form — `*bold*` is the only formatting available.
    const message = `*${subject}*\n\n${body}`;
    const result = await client.sendText(to, message);
    // Cloud API returns `{ messages: [{ id }] }` on success. The
    // `WhatsAppClient.request` helper throws on !ok, so reaching here
    // means the API accepted the send. Defensively check for the
    // expected shape.
    const wamid = (result as { messages?: Array<{ id?: string }> })?.messages?.[0]?.id;
    if (!wamid) {
      return { ok: false, error: 'whatsapp_no_message_id' };
    }
    return { ok: true };
  } catch (err) {
    // Meta returns useful error codes inside the response body which
    // `WhatsAppClient.request` includes in the thrown message. Surface
    // it directly so ops can grep for `(#131047)` (24-hour window) or
    // `(#131026)` (number not found) in the SecurityAlert audit rows.
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function buildSecurityAlertSenders(): AlertSenders {
  return {
    sendSecurityAlertEmail: sendEmail,
    sendSecurityAlertSlack: sendSlack,
    sendSecurityAlertWhatsapp: sendWhatsapp,
  };
}
