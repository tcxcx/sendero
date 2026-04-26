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
 * Token resolution (per-tenant first, env fallback):
 *   1. Look up the tenant's Sendero Slack install via
 *      `prisma.slackInstall.findFirst({ tenantId })`. Use that
 *      install's `botToken` so the message lands in the tenant's
 *      OWN workspace under the channel id they configured. This is
 *      the production path — alerts are tenant-scoped.
 *   2. Fall back to env `SLACK_BOT_TOKEN` for dev / single-tenant
 *      deployments where the env bot is the one installed in the
 *      workspace whose channel id is configured. Operator broadcasts
 *      (ops dashboards) keep using this path too.
 *
 * Alert routing failure modes:
 *   - Tenant has no SlackInstall AND no env token configured →
 *     `slack_not_configured`. Audit row still written upstream.
 *   - Channel id not in the resolved workspace → Slack returns
 *     `channel_not_found`; surfaced as `slack:channel_not_found`.
 */
/**
 * Resolve the Slack bot token for a tenant. Per-tenant install takes
 * precedence over the env fallback. Returns null when neither is
 * configured — caller emits `slack_not_configured`.
 *
 * Uses `findFirst` (not `findUnique`) because Enterprise Grid installs
 * carry an `enterpriseId` that breaks any single-tenant unique key;
 * sorting by `installedAt desc` picks the latest install, matching how
 * the events route resolves its install.
 */
async function resolveSlackBotToken(tenantId: string): Promise<string | null> {
  // Lazy-import Prisma so this module doesn't drag the DB client into
  // the @sendero/notifications dep graph (it lives in @sendero/app).
  try {
    const { prisma } = await import('@sendero/database');
    const install = await prisma.slackInstall.findFirst({
      where: { tenantId },
      orderBy: { installedAt: 'desc' },
      select: { botToken: true },
    });
    if (install?.botToken) return install.botToken;
  } catch (err) {
    // Don't let a transient DB error block the env fallback. The fallback
    // only works for single-tenant deploys where it's the right path
    // anyway; logging the failure surfaces a real misconfiguration in
    // ops triage.
    console.warn('[security-alerts] slack install lookup failed (falling back to env)', {
      tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return process.env.SLACK_BOT_TOKEN ?? null;
}

async function sendSlack(
  tenantId: string,
  channelId: string,
  subject: string,
  body: string
): Promise<AlertSendResult> {
  const botToken = await resolveSlackBotToken(tenantId);
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
 * 24 hours. Outside that window Meta returns `(#131047)` and we fall
 * back to the pre-approved `sendero_security_alert` HSM template
 * (see `packages/whatsapp/templates/sendero_security_alert.json`).
 *
 * The free-form path stays primary because (a) inside the 24-hour
 * window it's instant + cheaper, (b) the message can be richer
 * (newlines, *bold*), and (c) Meta charges per template send under
 * the per-conversation pricing model.
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
  const {
    WhatsAppClient,
    SENDERO_TEMPLATES,
    buildSecurityAlertComponents,
    isOutsideSessionWindowError,
  } = await import('@sendero/whatsapp');
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
  try {
    const result = await client.sendText(to, message);
    const wamid = (result as { messages?: Array<{ id?: string }> })?.messages?.[0]?.id;
    if (!wamid) {
      return { ok: false, error: 'whatsapp_no_message_id' };
    }
    return { ok: true };
  } catch (err) {
    if (!isOutsideSessionWindowError(err)) {
      // Real failure (auth, malformed payload, recipient unreachable).
      // Surface verbatim so ops can grep the SecurityAlert audit row.
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    // Outside the 24-hour window — fall back to the pre-approved HSM
    // template. Truncate body to Meta's 1024-char cap so the template
    // send doesn't bounce on (#132012) (parameter too long).
    const tpl = SENDERO_TEMPLATES.SECURITY_ALERT;
    try {
      const result = await client.sendTemplate({
        to,
        templateName: tpl.name,
        languageCode: tpl.defaultLocale,
        components: buildSecurityAlertComponents(
          subject.slice(0, 60),
          body.slice(0, 1024)
        ),
      });
      const wamid = (result as { messages?: Array<{ id?: string }> })?.messages?.[0]?.id;
      if (!wamid) {
        return { ok: false, error: 'whatsapp_template_no_message_id' };
      }
      return { ok: true };
    } catch (tplErr) {
      const detail = tplErr instanceof Error ? tplErr.message : String(tplErr);
      // (#132000) = template not found / not approved — surface clearly
      // so ops know to check the WABA template approval state.
      return { ok: false, error: `whatsapp_template_fallback:${detail}` };
    }
  }
}

export function buildSecurityAlertSenders(): AlertSenders {
  return {
    sendSecurityAlertEmail: sendEmail,
    sendSecurityAlertSlack: sendSlack,
    sendSecurityAlertWhatsapp: sendWhatsapp,
  };
}
