/**
 * Slack stay-booking action plumbing.
 *
 * Encodes / decodes the JSON payload the Slack `confirm_stay_booking`
 * and `cancel_stay_booking` buttons carry, plus the post-decision card
 * blocks that replace the original quote-review when the user taps.
 *
 * Wire format (button `value`, JSON):
 *   { q: quoteId, t: tenantId, tr?: tripId,
 *     e: travelerEmail, g: givenName, f: familyName }
 *
 * Slack's `value` field accepts up to ~2000 chars; this payload is
 * <250 chars worst case.
 */

import type { KnownBlock } from '@slack/web-api';

export interface ParsedStayBookingAction {
  decision: 'confirm' | 'cancel';
  quoteId: string;
  tenantId: string;
  tripId: string | null;
  travelerEmail: string;
  travelerGivenName: string;
  travelerFamilyName: string;
}

/**
 * Parse a `confirm_stay_booking` / `cancel_stay_booking` block-actions
 * payload. Returns null when the action_id isn't ours OR when the JSON
 * doesn't contain every required field — defensive against forged
 * button values from a hostile actor with chat access.
 */
export function parseStayBookingAction(action: {
  action_id: string;
  value?: string;
}): ParsedStayBookingAction | null {
  let decision: 'confirm' | 'cancel';
  if (action.action_id === 'confirm_stay_booking') decision = 'confirm';
  else if (action.action_id === 'cancel_stay_booking') decision = 'cancel';
  else return null;

  if (!action.value) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(action.value) as Record<string, unknown>;
  } catch {
    return null;
  }

  const q = typeof parsed.q === 'string' ? parsed.q : null;
  const t = typeof parsed.t === 'string' ? parsed.t : null;
  const e = typeof parsed.e === 'string' ? parsed.e : null;
  const g = typeof parsed.g === 'string' ? parsed.g : null;
  const f = typeof parsed.f === 'string' ? parsed.f : null;
  if (!q || !t || !e || !g || !f) return null;
  const tr = typeof parsed.tr === 'string' && parsed.tr.length > 0 ? parsed.tr : null;
  return {
    decision,
    quoteId: q,
    tenantId: t,
    tripId: tr,
    travelerEmail: e,
    travelerGivenName: g,
    travelerFamilyName: f,
  };
}

export interface StayResolvedSubject {
  hotelName: string;
  reference?: string;
  checkInDate?: string;
  checkOutDate?: string;
  totalAmount?: string;
  totalCurrency?: string;
}

/**
 * Replace the original quote-review card with a resolved state.
 * Mirrors `buildResolvedBlocks` from @sendero/slack/approval — same
 * shape, same one-line context line so both surfaces feel the same.
 */
export function buildStayResolvedBlocks(
  subject: StayResolvedSubject,
  decision: 'confirmed' | 'canceled' | 'failed',
  decidedBy: string,
  errorMessage?: string
): KnownBlock[] {
  const verb =
    decision === 'confirmed' ? 'Booked' : decision === 'canceled' ? 'Canceled' : 'Booking failed';
  const emoji =
    decision === 'confirmed' ? ':white_check_mark:' : decision === 'canceled' ? ':x:' : ':warning:';

  const dates =
    subject.checkInDate && subject.checkOutDate
      ? ` · ${subject.checkInDate} → ${subject.checkOutDate}`
      : '';
  const price =
    subject.totalAmount && subject.totalCurrency
      ? ` · ${subject.totalAmount} ${subject.totalCurrency}`
      : '';
  const ref = subject.reference ? `\n*Booking reference* \`${subject.reference}\`` : '';
  const errLine = errorMessage ? `\n_${errorMessage}_` : '';

  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: `${emoji} ${verb} · ${subject.hotelName}`, emoji: true },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${subject.hotelName}${dates}${price}${ref}${errLine}`,
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Decision by <@${decidedBy}> · ${new Date().toISOString()}`,
        },
      ],
    },
  ];
}
