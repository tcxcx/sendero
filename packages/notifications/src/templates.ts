/**
 * Email templates.
 *
 * Inline HTML + plaintext so we don't pull in a renderer dependency.
 * Templates are pure functions — callers decide how/when to send.
 */

export interface GuestInviteContent {
  /** Display name of the buyer (e.g. "Acme Corp Travel Desk"). */
  buyerName: string;
  /** Display name of the guest. Optional — falls back to "Traveler". */
  guestName?: string;
  /** Full URL the guest clicks to claim (fragment contains the claim key + nonce). */
  guestLink: string;
  /** 6-digit OTP sent out-of-band. When null, no 2FA is required. */
  claimCode: string | null;
  /** Human-readable budget, e.g. "$500". */
  budget: string;
  /** ISO string for trip expiry (shown as a date). */
  expiresAtIso: string;
  /** Route / destination, e.g. "SFO → LHR" or "New York". Optional context. */
  tripSummary?: string;
  /** Support email rendered in the footer. Defaults to 'hello@sendero.travel'. */
  supportEmail?: string;
}

export function renderGuestInvite(content: GuestInviteContent): { subject: string; html: string; text: string } {
  const guest = content.guestName ?? 'Traveler';
  const support = content.supportEmail ?? 'hello@sendero.travel';
  const expires = new Date(content.expiresAtIso).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const subject = content.tripSummary
    ? `${content.buyerName} is sending you to ${content.tripSummary} on Sendero`
    : `${content.buyerName} prefunded a trip for you on Sendero`;

  const codeBlock = content.claimCode
    ? `
      <tr>
        <td style="padding:24px 0 8px 0;color:#0b0b0b;font-size:14px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;">
          Your one-time claim code
        </td>
      </tr>
      <tr>
        <td>
          <div style="display:inline-block;padding:18px 28px;background:#141414;color:#ffb199;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:32px;font-weight:700;letter-spacing:0.24em;border-radius:12px;">
            ${content.claimCode}
          </div>
        </td>
      </tr>
      <tr>
        <td style="padding:12px 0 24px 0;color:#555;font-size:14px;line-height:1.6;">
          Enter this code on the claim page. Valid for one claim only.
          Never share it with anyone — Sendero will never ask for this code
          over the phone or chat.
        </td>
      </tr>`
    : '';

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f5f2ee;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e9e3da;border-radius:20px;padding:40px;text-align:left;">
            <tr>
              <td style="padding-bottom:24px;">
                <div style="font-size:14px;letter-spacing:0.18em;text-transform:uppercase;color:#b34b2e;font-weight:700;">
                  Sendero · Arc
                </div>
              </td>
            </tr>
            <tr>
              <td style="font-size:26px;font-weight:700;color:#0b0b0b;line-height:1.25;padding-bottom:16px;">
                Hi ${escapeHtml(guest)} — ${escapeHtml(content.buyerName)} funded a trip for you.
              </td>
            </tr>
            <tr>
              <td style="font-size:16px;color:#333;line-height:1.6;padding-bottom:24px;">
                Budget <strong>${escapeHtml(content.budget)}</strong>${content.tripSummary ? ` for <strong>${escapeHtml(content.tripSummary)}</strong>` : ''}, locked in escrow on Arc and available until <strong>${expires}</strong>.
                Click the button below, set up a passkey wallet (takes 15 seconds), and the trip is yours.
              </td>
            </tr>
            <tr>
              <td style="padding-bottom:8px;">
                <a href="${content.guestLink}"
                   style="display:inline-block;padding:14px 28px;background:#b34b2e;color:#ffffff;font-size:16px;font-weight:600;text-decoration:none;border-radius:999px;">
                  Claim your trip →
                </a>
              </td>
            </tr>
            <tr>
              <td style="font-size:13px;color:#888;padding:8px 0 24px 0;">
                This link carries the claim key in the URL fragment. It never touches Sendero's servers.
                If the button doesn't work, paste this URL into your browser:
                <div style="padding-top:6px;word-break:break-all;color:#555;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;">
                  ${escapeHtml(content.guestLink)}
                </div>
              </td>
            </tr>
            ${codeBlock}
            <tr>
              <td style="border-top:1px solid #ede6db;padding-top:24px;font-size:13px;color:#888;line-height:1.6;">
                Questions? Reply to this email or write us at <a href="mailto:${support}" style="color:#b34b2e;">${support}</a>.
                <br/><br/>
                Sendero is an AI travel agent running on Circle's Arc. Your claim is non-custodial —
                you hold the keys; Sendero books, we never hold funds after settlement.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [
    `Hi ${guest},`,
    ``,
    `${content.buyerName} funded a trip for you on Sendero${content.tripSummary ? ` — ${content.tripSummary}` : ''}.`,
    `Budget: ${content.budget}. Available until ${expires}.`,
    ``,
    `Claim here:`,
    content.guestLink,
    ...(content.claimCode ? ['', `One-time code: ${content.claimCode}`, `(Enter this on the claim page. Never share it.)`] : []),
    ``,
    `Questions? ${support}`,
  ].join('\n');

  return { subject, html, text };
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
