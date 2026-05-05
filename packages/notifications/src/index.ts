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
import { renderFromShare, type ShareEmailContent } from './share-template';
import {
  renderStayBookingConfirmed,
  type StayBookingConfirmedContent,
} from './stay-confirmation-template';
import {
  renderBookingConfirmed,
  renderHoldApproval,
  renderHoldConfirmed,
  renderPayLink,
  type BookingConfirmedContent,
  type HoldApprovalContent,
  type HoldConfirmedContent,
  type PayLinkEmailContent,
} from './trip-event-templates';

export type { GuestInviteContent } from './templates';
export { renderInvoiceEmail } from './invoice-email';
export type { InvoiceEmailContent } from './invoice-email';
export { renderFromShare } from './share-template';
export type { ShareEmailContent } from './share-template';
export { renderStayBookingConfirmed } from './stay-confirmation-template';
export type {
  StayBookingConfirmedContent,
  StayConfirmationAccommodation,
  StayConfirmationBilling,
  StayConfirmationBusiness,
  StayConfirmationCancellationEntry,
  StayConfirmationCondition,
} from './stay-confirmation-template';
export {
  renderBookingConfirmed,
  renderHoldApproval,
  renderHoldConfirmed,
  renderPayLink,
} from './trip-event-templates';
export type {
  BookingConfirmedContent,
  HoldApprovalContent,
  HoldConfirmedContent,
  ItinerarySegment,
  PayLinkEmailContent,
} from './trip-event-templates';

// OTP cleartext + on-chain hash + channel selector for the
// SenderoGuestEscrow guest-claim flow (v3.0.0+). See ./otp.ts.
export { generateOtpPreimage, otpClaimCodeHash, selectOtpChannel } from './otp';
export type {
  DeliveryChannel,
  GuestVerifiedContacts,
  OtpDeliveryRequest,
} from './otp';

// Buyer-alert pipeline for ClaimLockoutTriggered events. See ./security-alerts.ts.
export { handleClaimLockoutTriggered } from './security-alerts';
export type {
  AlertSenders,
  AlertSendResult,
  ClaimLockoutEvent,
  HandleClaimLockoutResult,
  SecurityAlertDeps,
  SecurityAlertInput,
  TenantNotificationContacts,
  TenantRow,
} from './security-alerts';

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
  /**
   * Trip-event email parity with the Slack approval card. Sent to the
   * org admin when a booking enters needs-operator-approval. The CTA
   * deep-links into /dashboard/console?tripId=…
   */
  sendHoldApproval(
    to: string,
    content: Omit<HoldApprovalContent, 'supportEmail'> & { supportEmail?: string }
  ): Promise<SendResult>;
  /**
   * Sent to the traveler when a hold clears review and the booking is
   * locked in (status flips pending → confirmed). Ticketing is async,
   * usually via the Duffel webhook → workflow resume path.
   */
  sendHoldConfirmed(
    to: string,
    content: Omit<HoldConfirmedContent, 'supportEmail'> & { supportEmail?: string }
  ): Promise<SendResult>;
  /**
   * Sent to the traveler (and typically cc'd to an org admin) when
   * ticketing succeeds (status reaches `ticketed` / `confirmed` end
   * state). Includes full itinerary + invoice link.
   *
   * Phase A.4: optional `attachments` carries the airline-issued
   * e-ticket PDF when Sendero successfully fetched it from Duffel
   * `GET /air/orders/{id}/documents`. The post-ticketing fan-out
   * passes `{ filename, contentType: 'application/pdf', content: <Buffer | url> }`.
   */
  sendBookingConfirmed(
    to: string,
    content: Omit<BookingConfirmedContent, 'supportEmail'> & {
      supportEmail?: string;
      attachments?: Array<{
        filename: string;
        content?: Buffer;
        path?: string;
        contentType?: string;
      }>;
    }
  ): Promise<SendResult>;
  /**
   * Generic share-card email. Same canonical shape every channel uses
   * (Slack block_image, WhatsApp interactive header, web bubble) — call
   * site sources `imageUrl` from `apps/app/lib/og/share-url::buildShareImageUrl`
   * so the email renders the same Satori card the other channels show.
   */
  sendShareCard(
    to: string,
    content: Omit<ShareEmailContent, 'supportEmail'> & { supportEmail?: string }
  ): Promise<SendResult>;
  /**
   * Magic-link payment email. Sent to the off-app traveler (agency
   * guest, B2C with no Clerk session) when the operator pre-funds them
   * and dispatches a one-tap pay link. The button deep-links to
   * `/pay/[bookingId]?t=<token>` — single-use, short TTL.
   */
  sendPayLink(
    to: string,
    content: Omit<PayLinkEmailContent, 'supportEmail'> & { supportEmail?: string }
  ): Promise<SendResult>;
  /**
   * Hotel-booking post-booking confirmation per Duffel Stays Go-Live
   * review criteria. Surfaces every required field — booking reference,
   * confirmed_at, billing breakdown (room/tax/fee/total separated),
   * cancellation timeline verbatim, conditions verbatim, key collection
   * always-visible, business details footer.
   */
  sendStayBookingConfirmed(to: string, content: StayBookingConfirmedContent): Promise<SendResult>;
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
      async sendHoldApproval() {
        return skipped;
      },
      async sendHoldConfirmed() {
        return skipped;
      },
      async sendBookingConfirmed() {
        return skipped;
      },
      async sendShareCard() {
        return skipped;
      },
      async sendPayLink() {
        return skipped;
      },
      async sendStayBookingConfirmed() {
        return skipped;
      },
    };
  }

  const client = new Resend(apiKey);

  return {
    async sendGuestInvite(to, content) {
      const rendered = renderGuestInvite({
        ...content,
        supportEmail: content.supportEmail ?? supportEmail,
      });
      try {
        const result = await client.emails.send({
          from,
          to: [to],
          replyTo: replyTo ? [replyTo] : undefined,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          tags: [{ name: 'surface', value: 'guest_invite' }, ...(content.tripSummary ? [] : [])],
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
    async sendHoldApproval(to, content) {
      const rendered = renderHoldApproval({
        ...content,
        supportEmail: content.supportEmail ?? supportEmail,
      });
      try {
        const result = await client.emails.send({
          from,
          to: [to],
          replyTo: replyTo ? [replyTo] : undefined,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          tags: [{ name: 'surface', value: 'hold_approval' }],
        });
        if (result.error) {
          return { ok: false, error: result.error.message ?? String(result.error) };
        }
        return { ok: true, id: result.data?.id };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    async sendHoldConfirmed(to, content) {
      const rendered = renderHoldConfirmed({
        ...content,
        supportEmail: content.supportEmail ?? supportEmail,
      });
      try {
        const result = await client.emails.send({
          from,
          to: [to],
          replyTo: replyTo ? [replyTo] : undefined,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          tags: [{ name: 'surface', value: 'hold_confirmed' }],
        });
        if (result.error) {
          return { ok: false, error: result.error.message ?? String(result.error) };
        }
        return { ok: true, id: result.data?.id };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    async sendBookingConfirmed(to, content) {
      const rendered = renderBookingConfirmed({
        ...content,
        supportEmail: content.supportEmail ?? supportEmail,
      });
      // Resend's `attachments` accepts either a Buffer (`content`) or a
      // remote URL (`path`). The post-ticketing fan-out fetches the
      // PDF buffer once and reuses it for both email and WhatsApp, so
      // we forward whatever the caller hands us without re-fetching.
      const attachments = Array.isArray(content.attachments)
        ? content.attachments
            .filter(a => a && (a.content || a.path))
            .map(a => ({
              filename: a.filename,
              ...(a.content ? { content: a.content } : {}),
              ...(a.path ? { path: a.path } : {}),
              ...(a.contentType ? { contentType: a.contentType } : {}),
            }))
        : undefined;
      try {
        const result = await client.emails.send({
          from,
          to: [to],
          replyTo: replyTo ? [replyTo] : undefined,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          ...(attachments && attachments.length > 0 ? { attachments } : {}),
          tags: [{ name: 'surface', value: 'booking_confirmed' }],
        });
        if (result.error) {
          return { ok: false, error: result.error.message ?? String(result.error) };
        }
        return { ok: true, id: result.data?.id };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    async sendShareCard(to, content) {
      const rendered = renderFromShare({
        ...content,
        supportEmail: content.supportEmail ?? supportEmail,
      });
      try {
        const result = await client.emails.send({
          from,
          to: [to],
          replyTo: replyTo ? [replyTo] : undefined,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          tags: [{ name: 'surface', value: 'share_card' }],
        });
        if (result.error) {
          return { ok: false, error: result.error.message ?? String(result.error) };
        }
        return { ok: true, id: result.data?.id };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    async sendPayLink(to, content) {
      const rendered = renderPayLink({
        ...content,
        supportEmail: content.supportEmail ?? supportEmail,
      });
      try {
        const result = await client.emails.send({
          from,
          to: [to],
          replyTo: replyTo ? [replyTo] : undefined,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          tags: [{ name: 'surface', value: 'pay_link' }],
        });
        if (result.error) {
          return { ok: false, error: result.error.message ?? String(result.error) };
        }
        return { ok: true, id: result.data?.id };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    async sendStayBookingConfirmed(to, content) {
      const rendered = renderStayBookingConfirmed(content);
      try {
        const result = await client.emails.send({
          from,
          to: [to],
          replyTo: replyTo ? [replyTo] : undefined,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          tags: [{ name: 'surface', value: 'stay_booking_confirmed' }],
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
