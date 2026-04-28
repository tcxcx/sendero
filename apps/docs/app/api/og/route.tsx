/**
 * Dynamic Open Graph image for docs.sendero.travel.
 *
 * Mirrors the marketing/app routes — same `@sendero/seo/og` card,
 * stamped with the docs surface label so unfurls clearly read as
 * documentation rather than the marketing site.
 *
 * Per-MDX OG: each docs page can override its share image by passing
 * a path-specific URL through the page's `metadata` export — see
 * `apps/docs/app/docs/[[...slug]]/page.tsx`'s `generateMetadata` for
 * the wiring.
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
// `contentType` is a valid export only on Next.js metadata files
// (image.tsx, opengraph-image.tsx). On a route.tsx it's rejected by
// Next 16's route validator. The Content-Type comes from the
// ImageResponse below — no manual export needed here.

export async function GET(request: NextRequest) {
  try {
    const params = parseOgQueryParams(new URL(request.url).searchParams);
    const [fonts, heroSrc] = await Promise.all([loadOgFonts(), loadHalftoneHeroDataUrl()]);
    return new ImageResponse(
      <SenderoOgCard {...params} site={params.site ?? 'docs.sendero.travel'} heroSrc={heroSrc} />,
      {
        ...OG_IMAGE_SIZE,
        fonts,
      }
    );
  } catch (err) {
    console.error('[og] docs render failed', err);
    return new Response('og render failed', { status: 500 });
  }
}
