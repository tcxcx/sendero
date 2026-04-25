/**
 * Prompts for the four stamp kinds.
 *
 * The image prompts are tuned to Gemini 2.5 Flash Image. They lean
 * into the brand's "vintage paper-stock travel artifact" vibe so all
 * four kinds feel like they belong to the same passport. Aspect ratio
 * is left to the model — Gemini returns variable dimensions and OG
 * unfurl bots crop gracefully (per plan v3 §13.v3).
 *
 * The caption prompts target GPT-5-nano via the AI Gateway. We ask
 * for a single short line (≤140 chars) suitable for the OG description
 * + collection-grid hover tooltip.
 */

import type { StampContext } from './types';

export function imagePromptForKind(ctx: StampContext): string {
  const { tenant, trip, booking } = ctx;
  const brand = tenant.displayName;
  const primary = tenant.primary ?? 'warm sepia';
  const secondary = tenant.secondary ?? 'deep navy';
  const route =
    trip.origin && trip.destination ? `${trip.origin} → ${trip.destination}` : 'a journey';

  switch (ctx.kind) {
    case 'BoardingPass':
      return [
        `A vintage 1960s airline boarding pass artifact, hand-illustrated on warm cream cardstock with letterpress feel.`,
        `Route: ${route}.`,
        booking?.carrier ? `Carrier: ${booking.carrier}.` : '',
        booking?.cabin ? `Cabin: ${booking.cabin}.` : '',
        `Brand: ${brand}. Primary color ${primary}; accent ${secondary}.`,
        `Slight wear, perforated edge, jet-age typography. No people, no plane in flight — just the ticket itself.`,
        `Square composition, photorealistic with paper grain and ink absorption. No text-as-text larger than route codes.`,
      ]
        .filter(Boolean)
        .join(' ');

    case 'SettlementReceipt':
      return [
        `A vintage railway-ticket style settlement receipt, printed on coarse off-white paper with a ${primary} ink stamp.`,
        booking?.totalUsd ? `Amount paid: USDC ${booking.totalUsd.toFixed(2)}.` : '',
        booking?.ref ? `Reference: ${booking.ref}.` : '',
        `Brand: ${brand} (${secondary} embossed seal in the corner).`,
        `Punched cancellation marks, slightly torn perforation. Square composition, paper-grain photorealism. No people.`,
      ]
        .filter(Boolean)
        .join(' ');

    case 'ItineraryMap':
      return [
        `A WPA-poster-style hand-drawn travel map.`,
        `Centerpiece: a flowing route line from ${trip.origin ?? 'origin'} to ${trip.destination ?? 'destination'} traced over a stylized world.`,
        `Palette: ${primary} for the route, ${secondary} for landmasses, cream paper background.`,
        `Compass rose top-right, a small stamped ${brand} cartouche bottom-right.`,
        `1930s travel-poster typography (no readable text larger than airport codes).`,
        `Square composition, screen-print texture, slight registration offset for authenticity.`,
      ].join(' ');

    case 'TripPassport':
      return [
        `A vintage passport spread, two facing pages on cream cardstock with marbled endpapers.`,
        `Left page: a stylized portrait illustration of the traveler (no real likeness).`,
        `Right page: four ink stamps — boarding pass, hotel, settlement receipt, itinerary map — overlapping at jaunty angles in ${primary} and ${secondary} ink.`,
        `Brand cartouche: ${brand}. Route: ${route}.`,
        `Slight page curl, embossed gold border, photorealistic paper grain. No readable text larger than country codes.`,
      ].join(' ');
  }
}

export function captionPromptForKind(ctx: StampContext): string {
  const { trip, booking } = ctx;
  const route =
    trip.origin && trip.destination ? `${trip.origin} → ${trip.destination}` : 'this trip';

  const baseRules = [
    'Return ONLY one sentence, max 140 characters.',
    'No quotation marks, no emoji, no hashtags, no labels like "Caption:".',
    'Plain text suitable for a unfurl preview.',
  ].join(' ');

  switch (ctx.kind) {
    case 'BoardingPass':
      return `Write a single warm one-liner in the voice of a journal entry, marking the moment a flight from ${route} was confirmed${booking?.carrier ? ` on ${booking.carrier}` : ''}. ${baseRules}`;
    case 'SettlementReceipt':
      return `Write a single one-liner acknowledging that a corporate travel booking was paid in full${booking?.totalUsd ? ` for USDC ${booking.totalUsd.toFixed(2)}` : ''}. Brisk, slightly proud, ledger-clerk voice. ${baseRules}`;
    case 'ItineraryMap':
      return `Write a single one-liner describing the route ${route} as if narrating a vintage travel poster. Sparse, evocative. ${baseRules}`;
    case 'TripPassport':
      return `Write a single one-liner closing a completed trip ${route}, in the voice of a passport stamp. Reflective, brief. ${baseRules}`;
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
