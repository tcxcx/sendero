/**
 * @sendero/notifications — outbound email via Resend.
 *
 * Stateless client. Callers pass a config (or rely on env vars) and
 * invoke a typed helper like `sendGuestInvite`. The package never
 * reads the database — upstream surfaces are responsible for deciding
 * *when* to send and for logging analytics.
 *
 * Env:
 *   RESEND_API_KEY           — Resend API key (required)
 *   SENDERO_EMAIL_FROM       — "Sendero <hello@sendero.travel>" (required)
 *   SENDERO_EMAIL_REPLY_TO   — optional override; defaults to SENDERO_EMAIL_FROM
 *   SENDERO_SUPPORT_EMAIL    — rendered in template footers (default hello@sendero.travel)
 */

import { Resend } from 'resend';
import { renderGuestInvite, type GuestInviteContent } from './templates';
import { renderInvoiceEmail, type InvoiceEmailContent } from './invoice-email';

export type { GuestInviteContent } from './templates';
export { renderInvoiceEmail } from './invoice-email';
export type { InvoiceEmailContent } from './invoice-email';

export interface NotificationsConfig {
  /** Resend API key. Falls back to process.env.RESEND_API_KEY. */
  apiKey?: string;
  /** RFC-5322 From header, e.g. 'Sendero <hello@sendero.travel>'. Falls back to SENDERO_EMAIL_FROM. */
  from?: string;
  /** Optional reply-to header. Defaults to `from`. */
  replyTo?: string;
  /** Support email rendered in footers. Defaults to SENDERO_SUPPORT_EMAIL or hello@sendero.travel. */
  supportEmail?: string;
}

export interface SendResult {
  ok: boolean;
  /** Resend message id when ok:true. */
  id?: string;
  /** Error reason when ok:false. */
  error?: string;
  /** True when the notifier is not configured (no API key). Caller can log and move on. */
  skipped?: boolean;
}

export interface SendInvoiceArgs extends InvoiceEmailContent {
  /** PDF rendered via @sendero/invoicing renderInvoicePdfBuffer. */
  pdfBuffer: Buffer;
  /** Override attachment filename. Defaults to `<invoice.number>.pdf`. */
  pdfFilename?: string;
}

export interface Notifier {
  sendGuestInvite(
    to: string,
    content: Omit<GuestInviteContent, 'supportEmail'> & { supportEmail?: string }
  ): Promise<SendResult>;
  sendInvoice(to: string, args: SendInvoiceArgs): Promise<SendResult>;
}

/**
 * Build a Notifier bound to a Resend key + From address. When either
 * is missing, every send returns `{ ok:false, skipped:true }` so callers
 * can no-op safely in dev without a provider configured.
 */
export function createNotifier(config: NotificationsConfig = {}): Notifier {
  const apiKey = config.apiKey ?? process.env.RESEND_API_KEY;
  const from = config.from ?? process.env.SENDERO_EMAIL_FROM;
  const replyTo = config.replyTo ?? process.env.SENDERO_EMAIL_REPLY_TO ?? from;
  const supportEmail =
    config.supportEmail ?? process.env.SENDERO_SUPPORT_EMAIL ?? 'hello@sendero.travel';

  if (!apiKey || !from) {
    const skipped: SendResult = {
      ok: false,
      skipped: true,
      error: 'notifications_not_configured: set RESEND_API_KEY and SENDERO_EMAIL_FROM',
    };
    return {
      async sendGuestInvite() {
        return skipped;
      },
      async sendInvoice() {
        return skipped;
      },
    };
  }

  const client = new Resend(apiKey);

  return {
    async sendGuestInvite(to, content) {
      const rendered = renderGuestInvite({ ...content, supportEmail: content.supportEmail ?? supportEmail });
      try {
        const result = await client.emails.send({
          from,
          to: [to],
          replyTo: replyTo ? [replyTo] : undefined,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          tags: [
            { name: 'surface', value: 'guest_invite' },
            ...(content.tripSummary ? [] : []),
          ],
        });
        if (result.error) {
          return { ok: false, error: result.error.message ?? String(result.error) };
        }
        return { ok: true, id: result.data?.id };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    async sendInvoice(to, args) {
      const rendered = renderInvoiceEmail({
        invoice: args.invoice,
        publicUrl: args.publicUrl,
        supportEmail: args.supportEmail ?? supportEmail,
      });
      try {
        const result = await client.emails.send({
          from,
          to: [to],
          replyTo: replyTo ? [replyTo] : undefined,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          attachments: [
            {
              filename: args.pdfFilename ?? `${args.invoice.number}.pdf`,
              content: args.pdfBuffer,
              contentType: 'application/pdf',
            },
          ],
          tags: [{ name: 'surface', value: 'invoice' }],
        });
        if (result.error) {
          return { ok: false, error: result.error.message ?? String(result.error) };
        }
        return { ok: true, id: result.data?.id };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}

/** Convenience — singleton for simple call sites. */
let defaultNotifier: Notifier | null = null;
export function notifier(): Notifier {
  if (!defaultNotifier) defaultNotifier = createNotifier();
  return defaultNotifier;
}

export function notificationsConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.SENDERO_EMAIL_FROM);
}
