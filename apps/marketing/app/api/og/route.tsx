/**
 * Dynamic Open Graph image for sendero.travel.
 *
 * Renders the canonical Sendero Satori card from `@sendero/seo/og`.
 * Query params:
 *   - title       (required, falls back to "Sendero")
 *   - description (optional)
 *   - eyebrow     (optional, defaults to "sendero.travel")
 *   - bullet      (repeatable, max 3 visible)
 *   - cta         (optional pill label)
 *   - accent      (optional hex override)
 *   - site        (optional surface label override)
 *
 * Used by:
 *   - The marketing root layout (default OG for sendero.travel home).
 *   - `createPageMetadata` for every /pricing, /agents, /updates,
 *     /policy, /terms subroute — each gets its own dynamic image
 *     stamped with the route's title + description.
 */

import { ImageResponse } from 'next/og';
import type { NextRequest } from 'next/server';

import {
  loadHalftoneHeroDataUrl,
  loadOgFonts,
  OG_IMAGE_SIZE,
  parseOgQueryParams,
  SenderoOgCard,
} from '@sendero/seo/og';

// Node runtime — fonts are loaded from the @sendero/fonts asset
// directory via fs.readFile, which the edge runtime can't do.
// Fluid Compute keeps cold start sub-200ms, well inside the 3s
// unfurl-bot budget.
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const params = parseOgQueryParams(new URL(request.url).searchParams);
    const [fonts, heroSrc] = await Promise.all([loadOgFonts(), loadHalftoneHeroDataUrl()]);
    return new ImageResponse(
      <SenderoOgCard {...params} site={params.site ?? 'sendero.travel'} heroSrc={heroSrc} />,
      {
        ...OG_IMAGE_SIZE,
        fonts,
      }
    );
  } catch (err) {
    console.error('[og] marketing render failed', err);
    return new Response('og render failed', { status: 500 });
  }
}
