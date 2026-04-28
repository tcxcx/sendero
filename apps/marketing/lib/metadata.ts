import type { Metadata } from 'next';

import { resolvePublicOrigin } from '@sendero/seo';

/**
 * createPageMetadata — Sendero adaptation of Midday's helper at
 * apps/website/src/lib/metadata.ts. Stamps canonical URL, OpenGraph,
 * Twitter card, optional keywords. Single source of truth for every
 * marketing subroute's `<head>` so SEO indexing stays consistent.
 *
 * Pairs with `apps/marketing/app/sitemap.ts` and the dynamic OG image
 * route at `apps/marketing/app/api/og/route.tsx` (when added).
 */

const SITE_URL = resolvePublicOrigin(process.env.NEXT_PUBLIC_SITE_URL, 'https://sendero.travel');

type PageMetadataOptions = {
  title: string;
  description: string;
  /** Path relative to the site root, e.g. `/agents`. Must start with `/`. */
  path: string;
  /** Optional override for the OG card title/description. */
  og?: { title?: string; description?: string };
  /** Optional keywords list for SEO. */
  keywords?: string[];
  type?: 'website' | 'article';
  /** Set to false to skip the canonical alternate. Defaults true. */
  canonical?: boolean;
};

export function createPageMetadata(opts: PageMetadataOptions): Metadata {
  const url = `${SITE_URL}${opts.path}`;
  const ogTitle = opts.og?.title ?? opts.title;
  const ogDesc = opts.og?.description ?? opts.description;

  // Static fallback OG until /api/og dynamic route lands. Marketing site
  // already ships /brand/marketing-hero-wide.png as a usable share image.
  const fallbackImage = `${SITE_URL}/brand/marketing-hero-wide.png`;
  const images = [{ url: fallbackImage, width: 1200, height: 630, alt: ogTitle }];

  return {
    title: opts.title,
    description: opts.description,
    ...(opts.keywords && { keywords: opts.keywords }),
    openGraph: {
      title: ogTitle,
      description: ogDesc,
      type: opts.type ?? 'website',
      url,
      siteName: 'Sendero',
      images,
    },
    twitter: {
      card: 'summary_large_image',
      title: ogTitle,
      description: ogDesc,
      images,
    },
    ...(opts.canonical !== false && { alternates: { canonical: url } }),
  };
}
