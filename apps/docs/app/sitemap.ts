import { buildSitemap, SENDERO_DOCS_ROUTES, type SitemapEntry } from '@sendero/seo';

const SITE_URL = process.env.NEXT_PUBLIC_DOCS_URL || 'https://docs.sendero.travel';
const SEO_LOCALES = ['en-US'] as const;

export default function sitemap(): SitemapEntry[] {
  return buildSitemap({
    siteUrl: SITE_URL,
    routes: SENDERO_DOCS_ROUTES,
    locales: SEO_LOCALES,
    defaultLocale: 'en-US',
  });
}
