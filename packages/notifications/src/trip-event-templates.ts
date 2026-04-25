/**
 * Trip-event email templates — hold approval, hold confirmed, booking
 * confirmed. These are the email parity for the Slack approval card +
 * resolved card flow, sent to orgs that don't use Slack (or as a
 * complement when both surfaces are wired).
 *
 * Same shape contract as `renderGuestInvite` / `renderInvoiceEmail`:
 * pure function, returns `{ subject, html, text }`. Visual style mirrors
 * the existing Sendero/Arc palette (cream background, Pretext orange CTA,
 * monospace for codes/itineraries) so the brand stays consistent.
 */

export interface ItinerarySegment {
  /** e.g. "AA 100" or carrier+number combined however the caller renders. */
  carrier: string;
  /** "SFO" / "LHR" — three-letter IATA. */
  origin: string;
  destination: string;
  /** ISO timestamp; rendered as a short local time + date. */
  departAt: string;
  /** ISO timestamp; optional second line on the segment row. */
  arriveAt?: string;
  /** "Economy" / "Business". Optional. */
  cabin?: string;
}

export interface HoldApprovalContent {
  /** Trip summary, e.g. "SFO → LHR · Apr 30 – May 7". */
  tripSummary: string;
  /** Display name of the traveler whose hold is awaiting approval. */
  travelerName: string;
  /** Human-readable hold amount, e.g. "$1,820.00". */
  amount: string;
  /** ISO 4217 or display string, e.g. "USD". */
  currency: string;
  /** ISO timestamp the hold expires at. Rendered as a date+time. */
  expiresAtIso: string;
  /** Reason the hold needs human-in-the-loop, e.g. "over_policy_cap". */
  reason: string;
  /** Direct link into /dashboard/console?tripId=… so the admin can act. */
  consoleUrl: string;
  /** Optional support email rendered in the footer. */
  supportEmail?: string;
}

export interface HoldConfirmedContent {
  tripSummary: string;
  travelerName: string;
  /** Booking PNR / locator (Duffel `booking_reference`, Amadeus PNR, etc.). */
  pnr: string;
  /** First segment's departure summary, e.g. "Apr 30, 09:15 SFO". */
  departureSummary: string;
  /** URL the traveler can open to view the trip / payment status. */
  tripUrl: string;
  supportEmail?: string;
}

export interface BookingConfirmedContent {
  tripSummary: string;
  travelerName: string;
  pnr: string;
  /** Full itinerary (one row per segment in the rendered email). */
  segments: ItinerarySegment[];
  /** Total fare, pre-formatted, e.g. "$1,820.00". */
  total: string;
  currency: string;
  /** Public invoice URL (the `/invoice/<token>` view). Optional. */
  invoiceUrl?: string;
  /** Trip console URL for the traveler. */
  tripUrl: string;
  supportEmail?: string;
}

// ─── shared rendering primitives ─────────────────────────────────────

function shell(innerHtml: string): string {
  return `<!doctype html>
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
            ${innerHtml}
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function footer(supportEmail: string): string {
  return `<tr>
              <td style="border-top:1px solid #ede6db;padding-top:24px;font-size:13px;color:#888;line-height:1.6;">
                Questions? Reply to this email or write us at <a href="mailto:${supportEmail}" style="color:#b34b2e;">${supportEmail}</a>.
              </td>
            </tr>`;
}

function ctaButton(href: string, label: string): string {
  return `<a href="${escapeAttr(href)}"
                   style="display:inline-block;padding:14px 28px;background:#b34b2e;color:#ffffff;font-size:16px;font-weight:600;text-decoration:none;border-radius:999px;">
                  ${escapeHtml(label)}
                </a>`;
}

function formatExpires(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

// ─── renderHoldApproval ──────────────────────────────────────────────

export function renderHoldApproval(content: HoldApprovalContent): {
  subject: string;
  html: string;
  text: string;
} {
  const support = content.supportEmail ?? 'hello@sendero.travel';
  const expires = formatExpires(content.expiresAtIso);
  const subject = `Action needed · approve hold for ${content.tripSummary}`;

  const inner = `
            <tr>
              <td style="font-size:24px;font-weight:700;color:#0b0b0b;line-height:1.25;padding-bottom:16px;">
                Hold needs your approval
              </td>
            </tr>
            <tr>
              <td style="font-size:16px;color:#333;line-height:1.6;padding-bottom:24px;">
                A hold for <strong>${escapeHtml(content.travelerName)}</strong> on
                <strong>${escapeHtml(content.tripSummary)}</strong> is awaiting an operator decision.
                Approve it to release the funds and ticket the booking, or reject it to refund the hold.
              </td>
            </tr>
            <tr>
              <td>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf6f0;border:1px solid #ede6db;border-radius:12px;padding:16px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;color:#333;line-height:1.7;">
                  <tr><td>Traveler: <strong>${escapeHtml(content.travelerName)}</strong></td></tr>
                  <tr><td>Trip: <strong>${escapeHtml(content.tripSummary)}</strong></td></tr>
                  <tr><td>Hold amount: <strong>${escapeHtml(content.currency)} ${escapeHtml(content.amount)}</strong></td></tr>
                  <tr><td>Expires: <strong>${escapeHtml(expires)}</strong></td></tr>
                  <tr><td>Reason: <strong>${escapeHtml(content.reason)}</strong></td></tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 0 8px 0;">
                ${ctaButton(content.consoleUrl, 'Approve in console')}
              </td>
            </tr>
            <tr>
              <td style="font-size:13px;color:#888;padding:8px 0 24px 0;">
                If the button doesn't work, paste this URL into your browser:
                <div style="padding-top:6px;word-break:break-all;color:#555;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;">
                  ${escapeHtml(content.consoleUrl)}
                </div>
              </td>
            </tr>
            ${footer(support)}`;

  const text = [
    `Hold needs your approval`,
    ``,
    `Traveler: ${content.travelerName}`,
    `Trip: ${content.tripSummary}`,
    `Hold amount: ${content.currency} ${content.amount}`,
    `Expires: ${expires}`,
    `Reason: ${content.reason}`,
    ``,
    `Approve in console:`,
    content.consoleUrl,
    ``,
    `Questions? ${support}`,
  ].join('\n');

  return { subject, html: shell(inner), text };
}

// ─── renderHoldConfirmed ─────────────────────────────────────────────

export function renderHoldConfirmed(content: HoldConfirmedContent): {
  subject: string;
  html: string;
  text: string;
} {
  const support = content.supportEmail ?? 'hello@sendero.travel';
  const subject = `Hold confirmed · ${content.tripSummary}`;

  const inner = `
            <tr>
              <td style="font-size:24px;font-weight:700;color:#0b0b0b;line-height:1.25;padding-bottom:16px;">
                Your hold is confirmed
              </td>
            </tr>
            <tr>
              <td style="font-size:16px;color:#333;line-height:1.6;padding-bottom:24px;">
                Hi ${escapeHtml(content.travelerName)}, your hold on <strong>${escapeHtml(content.tripSummary)}</strong>
                cleared review and the booking is locked in. Ticketing happens next, usually within a few minutes.
              </td>
            </tr>
            <tr>
              <td>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf6f0;border:1px solid #ede6db;border-radius:12px;padding:16px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;color:#333;line-height:1.7;">
                  <tr><td>Booking ref: <strong>${escapeHtml(content.pnr)}</strong></td></tr>
                  <tr><td>Departure: <strong>${escapeHtml(content.departureSummary)}</strong></td></tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 0 8px 0;">
                ${ctaButton(content.tripUrl, 'View trip')}
              </td>
            </tr>
            <tr>
              <td style="font-size:13px;color:#888;padding:8px 0 24px 0;">
                If the button doesn't work, paste this URL into your browser:
                <div style="padding-top:6px;word-break:break-all;color:#555;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;">
                  ${escapeHtml(content.tripUrl)}
                </div>
              </td>
            </tr>
            ${footer(support)}`;

  const text = [
    `Your hold is confirmed`,
    ``,
    `Hi ${content.travelerName},`,
    `Hold on ${content.tripSummary} cleared review.`,
    ``,
    `Booking ref: ${content.pnr}`,
    `Departure: ${content.departureSummary}`,
    ``,
    `View trip:`,
    content.tripUrl,
    ``,
    `Questions? ${support}`,
  ].join('\n');

  return { subject, html: shell(inner), text };
}

// ─── renderBookingConfirmed ──────────────────────────────────────────

export function renderBookingConfirmed(content: BookingConfirmedContent): {
  subject: string;
  html: string;
  text: string;
} {
  const support = content.supportEmail ?? 'hello@sendero.travel';
  const subject = `Booked · ${content.tripSummary}`;

  const segmentsHtml = content.segments
    .map(seg => {
      const depart = formatExpires(seg.departAt);
      const arrive = seg.arriveAt ? formatExpires(seg.arriveAt) : '';
      const cabin = seg.cabin ? ` · ${escapeHtml(seg.cabin)}` : '';
      return `<tr><td style="padding:6px 0;">
                  <strong>${escapeHtml(seg.carrier)}</strong> · ${escapeHtml(seg.origin)} → ${escapeHtml(seg.destination)}${cabin}
                  <div style="color:#666;">Departs ${escapeHtml(depart)}${arrive ? ` · arrives ${escapeHtml(arrive)}` : ''}</div>
                </td></tr>`;
    })
    .join('');

  const segmentsText = content.segments
    .map(seg => {
      const depart = formatExpires(seg.departAt);
      const arrive = seg.arriveAt ? ` arr ${formatExpires(seg.arriveAt)}` : '';
      const cabin = seg.cabin ? ` (${seg.cabin})` : '';
      return `  ${seg.carrier} ${seg.origin}->${seg.destination}${cabin} dep ${depart}${arrive}`;
    })
    .join('\n');

  const invoiceRowHtml = content.invoiceUrl
    ? `<tr>
              <td style="padding:8px 0 24px 0;">
                <a href="${escapeAttr(content.invoiceUrl)}" style="color:#b34b2e;font-weight:600;text-decoration:none;">
                  View invoice
                </a>
              </td>
            </tr>`
    : '';

  const inner = `
            <tr>
              <td style="font-size:24px;font-weight:700;color:#0b0b0b;line-height:1.25;padding-bottom:16px;">
                Booked · ${escapeHtml(content.tripSummary)}
              </td>
            </tr>
            <tr>
              <td style="font-size:16px;color:#333;line-height:1.6;padding-bottom:24px;">
                Hi ${escapeHtml(content.travelerName)}, ticketing succeeded. Full itinerary, PNR, and total below.
              </td>
            </tr>
            <tr>
              <td>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf6f0;border:1px solid #ede6db;border-radius:12px;padding:16px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;color:#333;line-height:1.7;">
                  <tr><td>PNR: <strong>${escapeHtml(content.pnr)}</strong></td></tr>
                  <tr><td>Total: <strong>${escapeHtml(content.currency)} ${escapeHtml(content.total)}</strong></td></tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 0 8px 0;font-size:14px;font-weight:600;color:#0b0b0b;letter-spacing:0.04em;text-transform:uppercase;">
                Itinerary
              </td>
            </tr>
            <tr>
              <td>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;color:#333;line-height:1.5;">
                  ${segmentsHtml}
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 0 8px 0;">
                ${ctaButton(content.tripUrl, 'View trip')}
              </td>
            </tr>
            ${invoiceRowHtml}
            ${footer(support)}`;

  const text = [
    `Booked: ${content.tripSummary}`,
    ``,
    `Hi ${content.travelerName},`,
    ``,
    `PNR: ${content.pnr}`,
    `Total: ${content.currency} ${content.total}`,
    ``,
    `Itinerary:`,
    segmentsText,
    ``,
    `View trip: ${content.tripUrl}`,
    ...(content.invoiceUrl ? [`Invoice: ${content.invoiceUrl}`] : []),
    ``,
    `Questions? ${support}`,
  ].join('\n');

  return { subject, html: shell(inner), text };
}

// ─── escape helpers ──────────────────────────────────────────────────

function escapeHtml(input: string): string {
  return String(input).replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c
  );
}

function escapeAttr(input: string): string {
  return escapeHtml(input);
}
