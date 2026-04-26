/**
 * Prompts for the four stamp kinds — brand-anchored per DESIGN.md.
 *
 * The image prompts target Gemini 2.5 Flash Image (Vertex AI). Every
 * prompt is composed of:
 *
 *   1. **Object cue**: what kind of artifact to draw (boarding pass,
 *      receipt, map, passport spread).
 *   2. **Trip context**: route, carrier, cabin, dates — pulled from
 *      the live booking.
 *   3. **Moodboard image refs**: passed in `messages[]` as multimodal
 *      input alongside the text. Vertex fetches the image URLs
 *      directly from `apps/app/public/brand/moodboard/`. See
 *      `./moodboard.ts` for the per-kind picks + per-ref guidance.
 *   4. **Brand anchor**: the universal Sendero visual rules (vermillion
 *      linework, parchment, hand-drawn editorial — `BRAND_ANCHOR_TEXT`).
 *
 * The caption prompts target Gemini 2.5 Flash-Lite. Single short line
 * (≤140 chars) suitable for the OG description + collection-grid
 * hover tooltip. Slack truncates around 150 chars and WhatsApp around
 * 160 — staying under 140 leaves a buffer.
 */

import { BRAND_ANCHOR_TEXT, type MoodboardRef, moodboardForKind } from './moodboard';
import type { StampContext } from './types';

/**
 * Compose the text portion of the image prompt. Pair this with the
 * moodboard refs from `imageReferencesForKind` and pass both to
 * Gemini via the AI SDK's multimodal `messages` API.
 */
export function imagePromptForKind(ctx: StampContext): string {
  const { tenant, trip, booking } = ctx;
  const brand = tenant.displayName;
  const route =
    trip.origin && trip.destination ? `${trip.origin} → ${trip.destination}` : 'a journey';

  const objectCue = (() => {
    switch (ctx.kind) {
      case 'BoardingPass':
        return [
          `Draw a vintage boarding pass ticket on cream parchment.`,
          `Route codes: ${trip.origin ?? 'JFK'} → ${trip.destination ?? 'GRU'}.`,
          booking?.carrier ? `Carrier code: ${booking.carrier}.` : '',
          booking?.cabin ? `Cabin label: ${booking.cabin}.` : '',
          `Perforated edge on the right, ticket-stub aesthetic, jet-age letterpress feel.`,
          `One small ${brand} cartouche stamp in the upper-right corner — small, not center stage.`,
          `No people, no plane in flight, no airport scene — just the ticket itself.`,
        ]
          .filter(Boolean)
          .join(' ');
      case 'SettlementReceipt':
        return [
          `Draw a vintage railway-ticket-style settlement receipt on coarse parchment.`,
          booking?.totalUsd
            ? `Amount stamped on it: USDC ${booking.totalUsd.toFixed(2)}.`
            : 'Amount stamped: USDC.',
          booking?.ref ? `Reference code visible: ${booking.ref}.` : '',
          `Punched cancellation marks suggesting the payment cleared.`,
          `Small ${brand} embossed seal in the lower-right corner.`,
          `No people, no logos other than the ${brand} seal.`,
        ]
          .filter(Boolean)
          .join(' ');
      case 'ItineraryMap':
        return [
          `Draw a hand-illustrated travel map.`,
          `Centerpiece: a flowing route line from ${trip.origin ?? 'origin'} to ${trip.destination ?? 'destination'} traced over a stylized landmass.`,
          `Compass rose top-right, small ${brand} cartouche bottom-right.`,
          `WPA-poster + Sendero map-room sensibility — no airline-website tropes.`,
          `City names readable but small; the route line is the hero.`,
        ].join(' ');
      case 'TripPassport':
        return [
          `Draw an open passport book spread on a parchment surface.`,
          `Both pages visible. Layered ink stamps on the right page in vermillion and midnight ink — overlapping at jaunty angles. Each stamp suggests a moment of the trip (boarding, hotel, settlement, route map).`,
          `Left page: blank or with a generic destination silhouette in soft sand-colored linework. NO name, NO photograph, NO passport number visible — only invented placeholder marks.`,
          `Small ${brand} brand cartouche embossed in the corner.`,
          `Route hint: ${route}. Use it for the destination silhouette only, not for printed text.`,
        ].join(' ');
    }
  })();

  return `${objectCue}\n\n${BRAND_ANCHOR_TEXT}`;
}

/**
 * Image references to attach to the Gemini multimodal request. Each
 * ref carries `url` + `guidance` — the guidance is folded into the
 * text prompt so the model knows what to take from the image and
 * what to ignore (especially names/PII).
 */
export function imageReferencesForKind(ctx: StampContext): MoodboardRef[] {
  return moodboardForKind(ctx.kind);
}

/**
 * Inline text describing the moodboard refs — concatenated into the
 * prompt so the model knows what each image is for. Keeps token cost
 * low (just one labelled line per ref) while making the image inputs
 * intelligible.
 */
export function moodboardGuidanceText(ctx: StampContext): string {
  const refs = moodboardForKind(ctx.kind);
  if (refs.length === 0) return '';
  const lines = refs.map(
    (r, i) => `Reference image ${i + 1} (${r.role}): ${r.guidance}`
  );
  return ['Reference images attached:', ...lines].join('\n');
}

export function captionPromptForKind(ctx: StampContext): string {
  const { trip, booking } = ctx;
  const route =
    trip.origin && trip.destination ? `${trip.origin} → ${trip.destination}` : 'this trip';

  const baseRules = [
    'Return ONLY one sentence, max 140 characters.',
    'No quotation marks, no emoji, no hashtags, no labels like "Caption:".',
    'Plain text suitable for an unfurl preview.',
    'Sendero voice: a smart travel guide with taste — editorial, observant, slightly literary, never gimmicky.',
  ].join(' ');

  switch (ctx.kind) {
    case 'BoardingPass':
      return `Write a single warm one-liner in the voice of a journal entry, marking the moment a flight from ${route} was confirmed${booking?.carrier ? ` on ${booking.carrier}` : ''}. ${baseRules}`;
    case 'SettlementReceipt':
      return `Write a single one-liner acknowledging that a corporate travel booking was paid in full${booking?.totalUsd ? ` for USDC ${booking.totalUsd.toFixed(2)}` : ''}. Brisk, slightly proud, ledger-clerk voice. ${baseRules}`;
    case 'ItineraryMap':
      return `Write a single one-liner describing the route ${route} as if narrating from a Sendero map-room — observant, sparse, evocative. ${baseRules}`;
    case 'TripPassport':
      return `Write a single one-liner closing a completed trip ${route}, in the voice of a passport stamp impression. Reflective, brief, editorial. ${baseRules}`;
  }
}

export function manifestNameForKind(ctx: StampContext): string {
  const route =
    ctx.trip.origin && ctx.trip.destination
      ? `${ctx.trip.origin}–${ctx.trip.destination}`
      : ctx.trip.tripId;
  switch (ctx.kind) {
    case 'BoardingPass':
      return `Boarding Pass · ${route}`;
    case 'SettlementReceipt':
      return `Settlement Receipt · ${route}`;
    case 'ItineraryMap':
      return `Itinerary Map · ${route}`;
    case 'TripPassport':
      return `Trip Passport · ${route}`;
  }
}
