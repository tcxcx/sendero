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
  /** Ordered list of variables the `body` component expects. */
  bodyVars: string[];
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
