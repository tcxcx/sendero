/**
 * Per-stamp-kind moodboard — image references passed to Gemini's
 * multimodal input alongside the text prompt. Token-cheap (just URLs;
 * Vertex fetches them server-side) and dramatically improves
 * brand-consistency vs text-only prompting.
 *
 * The references are curated from `apps/marketing/public/brand/*`,
 * mirrored under `apps/app/public/brand/moodboard/` so Vertex AI can
 * fetch them via `${NEXT_PUBLIC_APP_URL}/brand/moodboard/...` at
 * generation time.
 *
 * Per stamp kind, we send 1-2 images:
 *   - **One brand-canonical anchor** (Sendero's existing illustration
 *     style, parchment palette, vermillion linework) so the model
 *     locks onto the look-and-feel.
 *   - **One layout/composition reference** (e.g. a passport spread
 *     for TripPassport, a railway-receipt for SettlementReceipt) so
 *     it knows what kind of object to draw.
 *
 * Important: every prompt explicitly tells the model to NOT copy
 * names/PII visible in the references (e.g. the passport reference has
 * "Tomas Cordero" baked in — we want the LAYOUT, not the identity).
 */

import type { StampKind } from './types';

/**
 * Build a fully-qualified URL to a moodboard asset under the app's
 * public host. Vertex AI fetches via the URL (no base64 bloat in the
 * request payload).
 */
function moodboardUrl(filename: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.sendero.travel';
  return `${base.replace(/\/$/, '')}/brand/moodboard/${filename}`;
}

export interface MoodboardRef {
  url: string;
  /** What this image is for (helps the model interpret it). */
  role: 'brand_anchor' | 'composition' | 'palette';
  /** Plain-text note inserted into the prompt about how to use this ref. */
  guidance: string;
}

/**
 * Sendero's universal brand vocabulary — appended to every stamp
 * prompt so the model never wanders off-brand. Pulled from DESIGN.md
 * §5 (Visual Style Principles) + §6 (Color System).
 *
 * Keep this short — every additional sentence either guides or
 * dilutes. The brand colors + linework + grain + paper substrate
 * are non-negotiable; everything else can flex per kind.
 */
export const BRAND_ANCHOR_TEXT = `
Sendero brand: a smart travel guide with taste — editorial, hand-drawn, premium-but-warm.

Visual rules (LOCK):
- Loose vermillion linework (#D65438) on warm parchment background (#EEDCC7).
- Visible paper grain, subtle distressed print texture, slightly imperfect registration.
- Hand-drawn editorial sensibility — slightly literary, observant, map-room sensibility.
- Color accents from the brand palette only: midnight #1F2A44 (text/depth), sea #0F7C82 (travel ops/maps), sand #B6844E (warm editorial moments).
- Square composition.

NEVER:
- Shiny startup gradients, glassmorphism, generic tech blue.
- Sterile geometric perfection.
- Telegram/paper-plane/chat-app icon clichés or literal airplane silhouettes.
- AI-slop neon-on-dark backgrounds or digital-painter rendering.
- Any human face or recognizable person from the reference image.
- Any name, passport number, or PII text from the reference image.
`.trim();

/**
 * Pick the moodboard refs for a given stamp kind. Curated by hand
 * (NOT random) so the model gets the right composition cue per kind.
 */
export function moodboardForKind(kind: StampKind): MoodboardRef[] {
  switch (kind) {
    case 'BoardingPass':
      // Use the passport spread as a hand-drawn vintage-paper anchor.
      // The passport is NOT what we're drawing — we're drawing a
      // boarding pass — but it sets the paper substrate + linework
      // expectations spot-on.
      return [
        {
          url: moodboardUrl('passport-spread.png'),
          role: 'brand_anchor',
          guidance:
            'Match the parchment paper, vermillion linework, and warm palette. IGNORE the passport layout — we are drawing a boarding pass ticket. IGNORE all names and personal details visible in the reference; invent generic placeholder text only.',
        },
      ];
    case 'SettlementReceipt':
      return [
        {
          url: moodboardUrl('escrow-receipt.png'),
          role: 'composition',
          guidance:
            'Match the receipt/document composition, stamped feel, and warm parchment with vermillion + midnight ink. IGNORE specific text content — render new placeholder amount + reference codes per the prompt.',
        },
        {
          url: moodboardUrl('sendero-stamps-style.png'),
          role: 'brand_anchor',
          guidance: 'Match the linework weight, stamp aesthetic, paper substrate.',
        },
      ];
    case 'ItineraryMap':
      return [
        {
          url: moodboardUrl('route-map.png'),
          role: 'composition',
          guidance:
            'Match the map composition, route-line treatment, hand-drawn cartography, and parchment background. IGNORE specific city names or labels in the reference; use the cities from the prompt instead.',
        },
      ];
    case 'TripPassport':
      // The passport reference has "TOMAS CORDERO" stamped on it —
      // explicitly ban copying that text.
      return [
        {
          url: moodboardUrl('passport-with-stamps.png'),
          role: 'composition',
          guidance:
            'Match the open-passport layout, the visible page texture, the editorial linework, and the layered ink-stamp aesthetic. CRITICAL: do NOT copy any name, passport number, photograph, or personal text visible in the reference — invent neutral placeholder text or omit entirely. Stamp content should reflect the trip in the prompt, not the reference image.',
        },
      ];
  }
}
