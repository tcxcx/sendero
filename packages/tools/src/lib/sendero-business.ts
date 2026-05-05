/**
 * Sendero business details surfaced on every Stays-side card per Duffel
 * Go-Live review criteria. Pre-booking AND post-booking renders MUST
 * show: business name, address, customer service email + phone, T&C link.
 *
 * Single source so the operator preview, Slack, WhatsApp, web traveler
 * bubble, and the post-booking email all read the same line items.
 *
 * Kept in `@sendero/tools` so tool handlers can stamp the payload at
 * emission time. White-label tenants may override via `Tenant.metadata`
 * later — the renderer can swap out the default per tenant id.
 */

export interface SenderoBusinessDetails {
  name: string;
  address: string;
  supportEmail: string;
  supportPhone: string;
  termsUrl: string;
  /** Booking.com terms URL — Duffel attributes part of the inventory there. */
  bookingComTermsUrl?: string;
}

/**
 * Defaults pulled from `https://sendero.travel`. The web app surface
 * stamps these into `ChannelMessageStayQuoteReview.business` at
 * tool-emit time so the operator preview matches the channels.
 */
export const SENDERO_BUSINESS_DEFAULT: SenderoBusinessDetails = {
  name: 'Sendero Travel',
  address: '548 Market St #38322, San Francisco, CA 94104, USA',
  supportEmail: 'hello@sendero.travel',
  supportPhone: '+1 (415) 813-1131',
  termsUrl: 'https://sendero.travel/legal/terms',
  bookingComTermsUrl: 'https://www.booking.com/content/terms.html',
};

export function senderoBusinessDetails(
  override?: Partial<SenderoBusinessDetails>
): SenderoBusinessDetails {
  return { ...SENDERO_BUSINESS_DEFAULT, ...(override ?? {}) };
}
