/**
 * Invoice email template — subject + HTML + text.
 *
 * Rendered by sendInvoice() to attach a PDF and link recipients to the
 * public /invoice/<token> view. Matches the guest-invite palette (Arc
 * cream + Pretext orange) so the brand is consistent across surfaces.
 */

import type { TemplateProps } from '@sendero/invoicing/templates/types';

export interface InvoiceEmailContent {
  invoice: TemplateProps['invoice'];
  publicUrl: string;
  supportEmail?: string;
}

export function renderInvoiceEmail(c: InvoiceEmailContent): {
  subject: string;
  html: string;
  text: string;
} {
  const amount = c.invoice.total;
  const currency = c.invoice.currency;
  const support = c.supportEmail ?? 'hello@sendero.travel';
  const toName = c.invoice.to.name;
  const number = c.invoice.number;
  const subject = `Sendero · Invoice ${number} · ${currency} ${amount}`;

  const html = `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f5f2ee;font-family:-apple-system,BlinkMacSystemFont,Inter,'Segoe UI',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e9e3da;border-radius:20px;padding:40px;text-align:left;">
        <tr><td style="padding-bottom:24px;">
          <div style="font-size:14px;letter-spacing:0.18em;text-transform:uppercase;color:#b34b2e;font-weight:700;">Sendero · Arc</div>
        </td></tr>
        <tr><td style="font-size:24px;font-weight:700;padding-bottom:16px;color:#0b0b0b;">Invoice ${escapeHtml(number)}</td></tr>
        <tr><td style="color:#555;font-size:16px;line-height:1.6;">
          Hi ${escapeHtml(toName)},<br><br>
          Your invoice for <strong>${escapeHtml(currency)} ${escapeHtml(amount)}</strong> is attached. View online:
        </td></tr>
        <tr><td style="padding:24px 0;">
          <a href="${escapeAttr(c.publicUrl)}" style="display:inline-block;background:#fb542b;color:#ffffff;padding:14px 24px;border-radius:12px;text-decoration:none;font-weight:600;">View invoice</a>
        </td></tr>
        <tr><td style="color:#8a8a8a;font-size:12px;line-height:1.6;">
          Questions? Reply to this email or contact ${escapeHtml(support)}.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text =
    `Invoice ${number}\n\n` +
    `Hi ${toName},\n\n` +
    `Your invoice for ${currency} ${amount} is attached. View online: ${c.publicUrl}\n\n` +
    `Questions? ${support}`;

  return { subject, html, text };
}

function escapeHtml(s: string): string {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
