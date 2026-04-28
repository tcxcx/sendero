/**
 * Dynamic Open Graph image for apps.sendero.travel.
 *
 * Sibling of `apps/marketing/app/api/og/route.tsx` — same Satori card,
 * different surface label. Resource-specific OG cards (per-stamp,
 * per-agent, per-share-payload) live at:
 *   - /stamps/[tokenId]/opengraph-image
 *   - /agents/[kind]/[id]/opengraph-image
 *   - /api/og/share          (signed canonical share payload)
 *
 * This route handles the generic case — the app root + any operator
 * dashboard sub-page that just needs a brand-frame OG.
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

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const params = parseOgQueryParams(new URL(request.url).searchParams);
    const [fonts, heroSrc] = await Promise.all([loadOgFonts(), loadHalftoneHeroDataUrl()]);
    return new ImageResponse(
      <SenderoOgCard {...params} site={params.site ?? 'apps.sendero.travel'} heroSrc={heroSrc} />,
      {
        ...OG_IMAGE_SIZE,
        fonts,
      }
    );
  } catch (err) {
    console.error('[og] app render failed', err);
    return new Response('og render failed', { status: 500 });
  }
}
