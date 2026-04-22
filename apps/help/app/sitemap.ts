import { buildSitemap, SENDERO_HELP_ROUTES, type SitemapEntry } from '@sendero/seo';

const SITE_URL = process.env.NEXT_PUBLIC_HELP_URL || 'https://help.sendero.travel';
const SEO_LOCALES = ['en-US'] as const;

export default function sitemap(): SitemapEntry[] {
  return buildSitemap({
    siteUrl: SITE_URL,
    routes: SENDERO_HELP_ROUTES,
    locales: SEO_LOCALES,
    defaultLocale: 'en-US',
  });
}
