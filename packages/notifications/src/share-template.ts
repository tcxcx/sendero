/**
 * Share-payload email renderer.
 *
 * Mirrors the cross-channel share contract: a single `ShareEmailContent`
 * shape produces a Sendero-branded HTML email with an OG image at the
 * top, the title as the headline, the body as supporting copy, optional
 * bullets, and an optional primary CTA. Same source the Slack block kit
 * card / WhatsApp interactive header / web bubble consume, so an email
 * sent alongside those surfaces shows the same visual.
 *
 * Pure function. The caller decides where to source the OG image URL
 * (typically `apps/app/lib/og/share-url::buildShareImageUrl`). The
 * template never signs anything itself — it stays in the @sendero/notifications
 * package which has no Sendero secrets and no Next.js dependency.
 */

export interface ShareEmailContent {
  /** Card title. Becomes the email subject + h1. */
  title: string;
  /** Card body. Rendered as the lede paragraph. */
  body: string;
  /** Optional bullets, rendered as a list under the body. */
  bullets?: string[];
  /** Optional primary CTA. Rendered as the orange pill button. */
  primaryCta?: { label: string; href: string };
  /**
   * Pre-built OG image URL. When set, embedded at the top of the email
   * body at 600x315 (half-resolution of the 1200x630 OG canvas so the
   * email renders crisp on retina). Caller produces this via
   * `buildShareImageUrl` from `apps/app/lib/og/share-url`.
   */
  imageUrl?: string;
  /** Footer support email. Defaults to 'hello@sendero.travel'. */
  supportEmail?: string;
  /** Optional subject prefix override. Defaults to no prefix. */
  subjectPrefix?: string;
}

export function renderFromShare(content: ShareEmailContent): {
  subject: string;
  html: string;
  text: string;
} {
  const support = content.supportEmail ?? 'hello@sendero.travel';
  const subject = content.subjectPrefix
    ? `${content.subjectPrefix} ${content.title}`
    : content.title;

  const imageRow = content.imageUrl
    ? `<tr>
              <td style="padding-bottom:24px;">
                <img src="${escapeAttr(content.imageUrl)}" width="600" height="315" alt="${escapeAttr(content.title)}" style="display:block;width:100%;max-width:600px;height:auto;border-radius:16px;border:1px solid #ede6db;" />
              </td>
            </tr>`
    : '';

  const bulletsHtml =
    content.bullets && content.bullets.length > 0
      ? `<tr>
              <td style="padding:0 0 24px 0;">
                <ul style="margin:0;padding:0 0 0 20px;color:#333;font-size:15px;line-height:1.6;">
                  ${content.bullets.map(b => `<li style="padding:4px 0;">${escapeHtml(b)}</li>`).join('')}
                </ul>
              </td>
            </tr>`
      : '';

  const ctaHtml = content.primaryCta
    ? `<tr>
              <td style="padding:8px 0 24px 0;">
                <a href="${escapeAttr(content.primaryCta.href)}"
                   style="display:inline-block;padding:14px 28px;background:#b34b2e;color:#ffffff;font-size:16px;font-weight:600;text-decoration:none;border-radius:999px;">
                  ${escapeHtml(content.primaryCta.label)}
                </a>
              </td>
            </tr>`
    : '';

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f5f2ee;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e9e3da;border-radius:20px;padding:32px;text-align:left;">
            <tr>
              <td style="padding-bottom:20px;">
                <div style="font-size:14px;letter-spacing:0.18em;text-transform:uppercase;color:#b34b2e;font-weight:700;">
                  Sendero
                </div>
              </td>
            </tr>
            ${imageRow}
            <tr>
              <td style="font-size:24px;font-weight:700;color:#0b0b0b;line-height:1.25;padding-bottom:14px;">
                ${escapeHtml(content.title)}
              </td>
            </tr>
            <tr>
              <td style="font-size:16px;color:#333;line-height:1.6;padding-bottom:24px;">
                ${escapeHtml(content.body)}
              </td>
            </tr>
            ${bulletsHtml}
            ${ctaHtml}
            <tr>
              <td style="border-top:1px solid #ede6db;padding-top:20px;font-size:13px;color:#888;line-height:1.6;">
                Questions? Reply to this email or write us at <a href="mailto:${support}" style="color:#b34b2e;">${support}</a>.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [
    content.title,
    '',
    content.body,
    ...(content.bullets && content.bullets.length > 0
      ? ['', ...content.bullets.map(b => `- ${b}`)]
      : []),
    ...(content.primaryCta ? ['', `${content.primaryCta.label}: ${content.primaryCta.href}`] : []),
    '',
    `Questions? ${support}`,
  ].join('\n');

  return { subject, html, text };
}

function escapeHtml(input: string): string {
  return String(input).replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c
  );
}

function escapeAttr(input: string): string {
  return escapeHtml(input);
}
