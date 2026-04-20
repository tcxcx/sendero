import { buildSitemap, SENDERO_MARKETING_ROUTES, type SitemapEntry } from '@sendero/seo';
import { SUPPORTED_LOCALES } from '@sendero/locale';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://sendero.travel';

export default function sitemap(): SitemapEntry[] {
  return buildSitemap({
    siteUrl: SITE_URL,
    routes: SENDERO_MARKETING_ROUTES,
    locales: SUPPORTED_LOCALES,
    defaultLocale: 'en-US',
  });
}
