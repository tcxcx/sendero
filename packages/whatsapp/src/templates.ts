/**
 * Meta HSM (pre-approved) template registry + interactive button helpers.
 *
 * Sendero's WA business templates are pre-approved per WABA and per locale.
 * Register the production catalog here so callers pick templates by semantic
 * name (e.g. `TRIP_INVITE`) rather than hard-coding Meta template IDs.
 *
 * For out-of-session first-touch (booking confirmation, reminder, etc.) we
 * MUST use a template. Inside the 24-hour session we can send free-form.
 */

export interface TemplateDef {
  /** Meta template name as registered in the WABA. */
  name: string;
  /** Primary language; fallbacks live in `fallbackLocales`. */
  defaultLocale: string;
  /** Acceptable locale codes that Meta has approved for this template. */
  fallbackLocales: string[];
  /** Ordered list of variables the `body` component expects (positional). */
  bodyVars: string[];
  /** Ordered list of variables the `header` (TEXT) component expects. */
  headerVars?: string[];
  /**
   * Meta category. AUTHENTICATION templates have Meta-generated body
   * copy + a COPY_CODE button that needs the code as a button parameter
   * too — `buildOtpComponents` handles that wiring.
   */
  category?: 'AUTHENTICATION' | 'UTILITY' | 'MARKETING';
}

export const SENDERO_TEMPLATES = {
  TRIP_INVITE: {
    name: 'sendero_trip_invite',
    defaultLocale: 'en_US',
    fallbackLocales: ['es_MX', 'es_ES', 'pt_BR'],
    bodyVars: ['travelerName', 'tripSummary', 'inviteLink'],
  },
  BOOKING_CONFIRMATION: {
    name: 'sendero_booking_confirmation',
    defaultLocale: 'en_US',
    fallbackLocales: ['es_MX', 'pt_BR'],
    bodyVars: ['pnr', 'route', 'departAt'],
  },
  CHECKIN_REMINDER: {
    name: 'sendero_checkin_reminder',
    defaultLocale: 'en_US',
    fallbackLocales: ['es_MX', 'pt_BR'],
    bodyVars: ['pnr', 'departAt', 'gate'],
  },
  APPROVAL_REQUEST: {
    name: 'sendero_approval_request',
    defaultLocale: 'en_US',
    fallbackLocales: ['es_MX', 'pt_BR'],
    bodyVars: ['travelerName', 'amountUsd', 'route'],
  },
  /**
   * AUTHENTICATION-category OTP. Meta auto-generates the body copy
   * ("{{1}} is your verification code. For your security, do not share
   * this code.") and renders a COPY_CODE button. We only pass the
   * preimage as the body var; `buildOtpComponents` mirrors it into the
   * button parameter so COPY_CODE actually copies the right value.
   *
   * Why AUTHENTICATION over UTILITY: higher Meta approval rate, no
   * copy review, and the OTP UX (auto-fill on Android, copy button)
   * is first-class.
   */
  OTP_RESEND: {
    name: 'sendero_otp',
    defaultLocale: 'en_US',
    fallbackLocales: ['es_MX', 'es_ES', 'pt_BR'],
    bodyVars: ['code'],
    category: 'AUTHENTICATION',
  },
  /**
   * UTILITY-category lockout / security ping. Used by
   * `apps/app/lib/security-alert-senders.ts → sendWhatsapp()` when
   * the recipient is outside the 24-hour session window (Meta error
   * `(#131047)`). Header carries the subject, body carries the alert
   * text — same shape as the in-window free-form fallback.
   */
  SECURITY_ALERT: {
    name: 'sendero_security_alert',
    defaultLocale: 'en_US',
    fallbackLocales: ['es_MX', 'pt_BR'],
    bodyVars: ['body'],
    headerVars: ['subject'],
    category: 'UTILITY',
  },
} as const satisfies Record<string, TemplateDef>;

export type SenderoTemplateKey = keyof typeof SENDERO_TEMPLATES;

/** Pick the best-matching Meta locale for a BCP-47 tag (e.g. es-AR → es_MX). */
export function resolveTemplateLocale(
  def: TemplateDef,
  requestedLocale: string | undefined
): string {
  if (!requestedLocale) return def.defaultLocale;
  const metaLocale = requestedLocale.replace('-', '_');
  if (metaLocale === def.defaultLocale) return def.defaultLocale;
  if (def.fallbackLocales.includes(metaLocale)) return metaLocale;
  const base = metaLocale.split('_')[0];
  const found =
    [def.defaultLocale, ...def.fallbackLocales].find(c => c.split('_')[0] === base) ??
    def.defaultLocale;
  return found;
}

/**
 * Encode a button id for approval flows. Round-trip-safe parse via
 * `parseApprovalButtonId`.
 *
 *   approveTripButton('trip_abc123') → 'sendero.approve.trip_abc123'
 */
export function encodeApprovalButtonId(action: 'approve' | 'reject', subjectId: string): string {
  return `sendero.${action}.${subjectId}`;
}

export function parseApprovalButtonId(
  buttonId: string
): { action: 'approve' | 'reject'; subjectId: string } | null {
  const match = /^sendero\.(approve|reject)\.(.+)$/.exec(buttonId);
  if (!match) return null;
  return { action: match[1] as 'approve' | 'reject', subjectId: match[2] };
}

// ── Send-time component builders ─────────────────────────────────────
//
// The shape below matches `WhatsAppClient.sendTemplate()`'s
// `components` parameter. Keeping the construction here means callers
// in apps/* don't need to know Meta's positional-parameter quirks.

export type TemplateComponent = {
  type: 'header' | 'body' | 'button';
  parameters: Array<{ type: 'text' | 'currency' | 'date_time'; text?: string }>;
  sub_type?: 'quick_reply' | 'url';
  index?: number;
};

/**
 * Build the components array for a `sendero_otp` (AUTHENTICATION) send.
 * Meta requires the code on BOTH the body component (for the auto-built
 * copy) and the button component (so COPY_CODE copies the right value).
 */
export function buildOtpComponents(code: string): TemplateComponent[] {
  return [
    {
      type: 'body',
      parameters: [{ type: 'text', text: code }],
    },
    {
      type: 'button',
      sub_type: 'url',
      index: 0,
      parameters: [{ type: 'text', text: code }],
    },
  ];
}

/**
 * Build the components array for a `sendero_security_alert` (UTILITY)
 * send. Header `{{1}}` = subject, body `{{1}}` = body text. Mirrors
 * the in-session free-form sender's `*subject*\n\n${body}` hierarchy.
 */
export function buildSecurityAlertComponents(
  subject: string,
  body: string
): TemplateComponent[] {
  return [
    {
      type: 'header',
      parameters: [{ type: 'text', text: subject }],
    },
    {
      type: 'body',
      parameters: [{ type: 'text', text: body }],
    },
  ];
}

/**
 * Meta returns specific error codes when a free-form (`type: 'text'`)
 * message lands outside the 24-hour customer service window. Detect
 * those so callers can fall back to a registered HSM template.
 *
 *   (#131047) — re-engagement message; recipient hasn't messaged in 24h
 *   (#131026) — message undeliverable; common when channel is closed
 *
 * Substring match on the thrown error message is fine — the WhatsApp
 * Cloud client surfaces Meta's body verbatim.
 */
export function isOutsideSessionWindowError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /\(#131047\)|\(#131026\)/.test(msg);
}
