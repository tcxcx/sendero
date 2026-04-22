import {
  buildSitemap,
  resolvePublicOrigin,
  SENDERO_MARKETING_ROUTES,
  type SitemapEntry,
} from '@sendero/seo';

const SITE_URL = resolvePublicOrigin(process.env.NEXT_PUBLIC_SITE_URL, 'https://sendero.travel');
const SEO_LOCALES = ['en-US'] as const;

export default function sitemap(): SitemapEntry[] {
  return buildSitemap({
    siteUrl: SITE_URL,
    routes: SENDERO_MARKETING_ROUTES,
    locales: SEO_LOCALES,
    defaultLocale: 'en-US',
  });
}
