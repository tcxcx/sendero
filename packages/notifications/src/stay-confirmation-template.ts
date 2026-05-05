/**
 * renderStayBookingConfirmed — post-booking email per Duffel Go-Live.
 *
 * Surfaces every Duffel-mandated field:
 *   • API-returned booking reference (verbatim)
 *   • confirmedAt timestamp
 *   • guests + rooms + nights
 *   • accommodation name + address
 *   • check-in/out dates + times
 *   • Billing summary — Room / Taxes / Fees / Total separated
 *   • Payment schedule — Paid today + Due at accommodation (visible even at 0)
 *   • Cancellation policy verbatim
 *   • Conditions verbatim (no expand action)
 *   • Key collection — always visible, with fallback when API returned null
 *   • Sendero business details + T&C link + Booking.com link when applicable
 *
 * Input is decoupled from `@sendero/tools::StayBookingConfirmationPayload`
 * so this package keeps its dependency leaf (no DB, no agent imports).
 */

export interface StayConfirmationBilling {
  baseAmount: string | null;
  baseCurrency: string | null;
  taxAmount: string;
  taxCurrency: string;
  feeAmount: string;
  feeCurrency: string;
  totalAmount: string;
  totalCurrency: string;
  dueAtAccommodationAmount: string;
  dueAtAccommodationCurrency: string;
}

export interface StayConfirmationAccommodation {
  name: string;
  address: string | null;
  city: string | null;
  country: string | null;
  checkInAfter: string | null;
  checkOutBefore: string | null;
  keyCollection: string | null;
}

export interface StayConfirmationCancellationEntry {
  before: string;
  refundAmount: string;
  currency: string;
}

export interface StayConfirmationCondition {
  title: string;
  description: string;
}

export interface StayConfirmationBusiness {
  name: string;
  address: string;
  supportEmail: string;
  supportPhone: string;
  termsUrl: string;
  bookingComTermsUrl?: string;
}

export interface StayBookingConfirmedContent {
  travelerName: string;
  reference: string;
  confirmedAt: string | null;
  accommodation: StayConfirmationAccommodation;
  checkInDate: string;
  checkOutDate: string;
  nights: number;
  rooms: number;
  guests: number;
  roomName: string | null;
  billing: StayConfirmationBilling;
  cancellationTimeline: StayConfirmationCancellationEntry[];
  conditions: StayConfirmationCondition[];
  /** Public Sendero trip-brief share URL when available. */
  tripUrl?: string | null;
  business: StayConfirmationBusiness;
}

function escapeHtml(input: string): string {
  return String(input).replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c
  );
}
const escapeAttr = escapeHtml;

function fmtMoney(amount: string, currency: string): string {
  if (!amount) return '—';
  const n = Number(amount);
  if (Number.isNaN(n)) return `${amount} ${currency}`;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n);
  } catch {
    return `${amount} ${currency}`;
  }
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function shell(innerHtml: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f5f2ee;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e9e3da;border-radius:20px;padding:40px;text-align:left;">
            ${innerHtml}
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function billingTable(b: StayConfirmationBilling): string {
  const row = (label: string, amount: string, currency: string, emphasis = false) =>
    `<tr>
      <td style="padding:6px 0;font-size:14px;color:${emphasis ? '#0b0b0b' : '#666'};${emphasis ? 'font-weight:700;' : ''}">${escapeHtml(label)}</td>
      <td align="right" style="padding:6px 0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:14px;color:#0b0b0b;${emphasis ? 'font-weight:700;' : ''}">${escapeHtml(fmtMoney(amount, currency))}</td>
    </tr>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    ${row('Room', b.baseAmount ?? b.totalAmount, b.baseCurrency ?? b.totalCurrency)}
    ${row('Taxes', b.taxAmount, b.taxCurrency)}
    ${row('Fees', b.feeAmount, b.feeCurrency)}
    <tr><td colspan="2" style="border-top:1px solid #ede6db;padding:0;"></td></tr>
    ${row('Total', b.totalAmount, b.totalCurrency, true)}
  </table>`;
}

function paymentScheduleTable(b: StayConfirmationBilling): string {
  const row = (label: string, amount: string, currency: string) =>
    `<tr>
      <td style="padding:6px 0;font-size:14px;color:#666;">${escapeHtml(label)}</td>
      <td align="right" style="padding:6px 0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:14px;color:#0b0b0b;">${escapeHtml(fmtMoney(amount, currency))}</td>
    </tr>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    ${row('Paid today', b.totalAmount, b.totalCurrency)}
    ${row('Due at accommodation', b.dueAtAccommodationAmount, b.dueAtAccommodationCurrency)}
  </table>`;
}

function cancellationTable(
  entries: StayConfirmationCancellationEntry[],
  totalAmount: string
): string {
  if (!entries.length) {
    return `<p style="margin:0;font-size:14px;color:#666;">Non-refundable — no refund after booking.</p>`;
  }
  const rows = entries.map(t => {
    const isFull = Number(t.refundAmount) >= Number(totalAmount);
    return `<tr>
      <td style="padding:6px 0;font-size:14px;color:${isFull ? '#1a7a3a' : '#b07e2c'};">${isFull ? '✓ Full refund' : '⚠ Partial refund'} until ${escapeHtml(t.before.slice(0, 10))}</td>
      <td align="right" style="padding:6px 0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:14px;">${escapeHtml(fmtMoney(t.refundAmount, t.currency))}</td>
    </tr>`;
  });
  rows.push(
    `<tr>
      <td colspan="2" style="padding:6px 0;font-size:14px;color:#a33;">✗ No refund after ${escapeHtml(entries[entries.length - 1]!.before.slice(0, 10))}</td>
    </tr>`
  );
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.join('')}</table>`;
}

function conditionsBlock(conditions: StayConfirmationCondition[]): string {
  if (!conditions.length) return '';
  const blocks = conditions
    .map(
      c => `<div style="margin-bottom:12px;">
        <div style="font-size:14px;font-weight:600;color:#0b0b0b;">${escapeHtml(c.title)}</div>
        ${c.description ? `<div style="font-size:13px;color:#444;line-height:1.6;white-space:pre-wrap;">${escapeHtml(c.description)}</div>` : ''}
      </div>`
    )
    .join('');
  return `<div style="margin:24px 0;padding:16px;background:#faf6f0;border:1px solid #ede6db;border-radius:12px;">
    <div style="font-size:12px;letter-spacing:0.16em;text-transform:uppercase;color:#888;margin-bottom:12px;">Hotel policy &amp; rate conditions</div>
    ${blocks}
  </div>`;
}

function keyCollectionBlock(instructions: string | null): string {
  const text =
    instructions ?? 'Ask at the property on arrival — Duffel returned no key-collection note.';
  return `<div style="margin:24px 0;padding:16px;background:#faf6f0;border:1px solid #ede6db;border-radius:12px;">
    <div style="font-size:12px;letter-spacing:0.16em;text-transform:uppercase;color:#888;margin-bottom:8px;">Key collection</div>
    <div style="font-size:14px;color:#0b0b0b;line-height:1.6;white-space:pre-wrap;">${escapeHtml(text)}</div>
  </div>`;
}

function businessFooterBlock(b: StayConfirmationBusiness): string {
  return `<tr>
    <td style="border-top:1px solid #ede6db;padding-top:24px;font-size:12px;color:#777;line-height:1.6;">
      <div style="font-weight:600;color:#0b0b0b;">Sold by ${escapeHtml(b.name)}</div>
      <div>${escapeHtml(b.address)}</div>
      <div style="margin-top:6px;">
        <a href="mailto:${escapeAttr(b.supportEmail)}" style="color:#b34b2e;">${escapeHtml(b.supportEmail)}</a> ·
        <a href="tel:${escapeAttr(b.supportPhone.replace(/[^0-9+]/g, ''))}" style="color:#b34b2e;">${escapeHtml(b.supportPhone)}</a>
      </div>
      <div style="margin-top:6px;">
        <a href="${escapeAttr(b.termsUrl)}" style="color:#b34b2e;">Booking conditions &amp; T&amp;C</a>
        ${b.bookingComTermsUrl ? `· <a href="${escapeAttr(b.bookingComTermsUrl)}" style="color:#b34b2e;">Booking.com terms</a>` : ''}
      </div>
    </td>
  </tr>`;
}

export function renderStayBookingConfirmed(content: StayBookingConfirmedContent): {
  subject: string;
  html: string;
  text: string;
} {
  const { accommodation: a, billing: b, business } = content;
  const subject = `Booking confirmed · ${a.name} · ${content.reference}`;
  const checkInLine = `${content.checkInDate}${a.checkInAfter ? ` · from ${a.checkInAfter}` : ''}`;
  const checkOutLine = `${content.checkOutDate}${a.checkOutBefore ? ` · until ${a.checkOutBefore}` : ''}`;

  const inner = `
    <tr>
      <td style="padding-bottom:8px;">
        <div style="font-size:13px;letter-spacing:0.18em;text-transform:uppercase;color:#1a7a3a;font-weight:700;">
          ✓ Booking confirmed
        </div>
      </td>
    </tr>
    <tr>
      <td style="font-size:24px;font-weight:700;color:#0b0b0b;line-height:1.25;padding-bottom:8px;">
        ${escapeHtml(a.name)}
      </td>
    </tr>
    ${a.address ? `<tr><td style="font-size:14px;color:#666;padding-bottom:16px;">${escapeHtml(a.address)}</td></tr>` : ''}
    <tr>
      <td style="font-size:13px;color:#888;letter-spacing:0.04em;padding-bottom:24px;">
        ${content.rooms} room${content.rooms === 1 ? '' : 's'} · ${content.guests} guest${content.guests === 1 ? '' : 's'} · ${content.nights} night${content.nights === 1 ? '' : 's'}${content.roomName ? ` · ${escapeHtml(content.roomName)}` : ''}
      </td>
    </tr>
    <tr>
      <td>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf6f0;border:1px solid #ede6db;border-radius:12px;padding:16px;font-size:14px;color:#333;line-height:1.6;">
          <tr>
            <td>Booking reference</td>
            <td align="right" style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:700;">${escapeHtml(content.reference)}</td>
          </tr>
          ${content.confirmedAt ? `<tr><td>Confirmed at</td><td align="right">${escapeHtml(fmtDateTime(content.confirmedAt))}</td></tr>` : ''}
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:24px 0 8px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td width="50%" valign="top" style="padding-right:12px;">
              <div style="font-size:12px;letter-spacing:0.16em;text-transform:uppercase;color:#888;">Check in</div>
              <div style="font-size:16px;font-weight:600;color:#0b0b0b;padding-top:4px;">${escapeHtml(checkInLine)}</div>
            </td>
            <td width="50%" valign="top" style="padding-left:12px;border-left:1px solid #ede6db;">
              <div style="font-size:12px;letter-spacing:0.16em;text-transform:uppercase;color:#888;">Check out</div>
              <div style="font-size:16px;font-weight:600;color:#0b0b0b;padding-top:4px;">${escapeHtml(checkOutLine)}</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:24px 0 8px 0;font-size:12px;letter-spacing:0.16em;text-transform:uppercase;color:#888;">
        Billing summary
      </td>
    </tr>
    <tr><td>${billingTable(b)}</td></tr>
    <tr>
      <td style="padding:24px 0 8px 0;font-size:12px;letter-spacing:0.16em;text-transform:uppercase;color:#888;">
        Payment schedule
      </td>
    </tr>
    <tr><td>${paymentScheduleTable(b)}</td></tr>
    <tr>
      <td style="padding:24px 0 8px 0;font-size:12px;letter-spacing:0.16em;text-transform:uppercase;color:#888;">
        Cancellation policy
      </td>
    </tr>
    <tr><td>${cancellationTable(content.cancellationTimeline, b.totalAmount)}</td></tr>
    <tr><td>${conditionsBlock(content.conditions)}</td></tr>
    <tr><td>${keyCollectionBlock(a.keyCollection)}</td></tr>
    ${
      content.tripUrl
        ? `<tr><td style="padding:24px 0 8px 0;"><a href="${escapeAttr(content.tripUrl)}" style="display:inline-block;padding:14px 28px;background:#b34b2e;color:#ffffff;font-size:16px;font-weight:600;text-decoration:none;border-radius:999px;">View trip</a></td></tr>`
        : ''
    }
    ${businessFooterBlock(business)}`;

  const text = [
    `Booking confirmed: ${a.name}`,
    `Reference: ${content.reference}`,
    content.confirmedAt ? `Confirmed at ${fmtDateTime(content.confirmedAt)}` : '',
    a.address ?? '',
    `${content.rooms} room${content.rooms === 1 ? '' : 's'} · ${content.guests} guest${content.guests === 1 ? '' : 's'} · ${content.nights} night${content.nights === 1 ? '' : 's'}${content.roomName ? ` · ${content.roomName}` : ''}`,
    '',
    `Check in: ${checkInLine}`,
    `Check out: ${checkOutLine}`,
    '',
    'Billing summary:',
    `  Room    ${fmtMoney(b.baseAmount ?? b.totalAmount, b.baseCurrency ?? b.totalCurrency)}`,
    `  Taxes   ${fmtMoney(b.taxAmount, b.taxCurrency)}`,
    `  Fees    ${fmtMoney(b.feeAmount, b.feeCurrency)}`,
    `  Total   ${fmtMoney(b.totalAmount, b.totalCurrency)}`,
    '',
    'Payment schedule:',
    `  Paid today           ${fmtMoney(b.totalAmount, b.totalCurrency)}`,
    `  Due at accommodation ${fmtMoney(b.dueAtAccommodationAmount, b.dueAtAccommodationCurrency)}`,
    '',
    'Cancellation policy:',
    ...(content.cancellationTimeline.length
      ? content.cancellationTimeline.map(t => {
          const isFull = Number(t.refundAmount) >= Number(b.totalAmount);
          return `  ${isFull ? '✓ Full refund' : '⚠ Partial refund'} until ${t.before.slice(0, 10)} — ${fmtMoney(t.refundAmount, t.currency)}`;
        })
      : ['  Non-refundable — no refund after booking.']),
    '',
    ...(content.conditions.length
      ? [
          'Hotel policy & rate conditions:',
          ...content.conditions.flatMap(c => [
            `  ${c.title}`,
            c.description ? `    ${c.description}` : '',
          ]),
          '',
        ]
      : []),
    `Key collection: ${a.keyCollection ?? 'Ask at the property on arrival — Duffel returned no key-collection note.'}`,
    '',
    content.tripUrl ? `View trip: ${content.tripUrl}` : '',
    '',
    `Sold by ${business.name}`,
    business.address,
    `${business.supportEmail} · ${business.supportPhone}`,
    `Booking conditions & T&C: ${business.termsUrl}`,
    business.bookingComTermsUrl ? `Booking.com terms: ${business.bookingComTermsUrl}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return { subject, html: shell(inner), text };
}
