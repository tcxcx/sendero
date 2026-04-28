import { SUPPORTED_LOCALES } from '@sendero/locale';
import {
  buildSitemap,
  resolvePublicOrigin,
  SENDERO_APP_PUBLIC_ROUTES,
  type SitemapEntry,
} from '@sendero/seo';

const SITE_URL = resolvePublicOrigin(process.env.NEXT_PUBLIC_APP_URL, 'https://app.sendero.travel');
const SEO_LOCALES = SUPPORTED_LOCALES;

export default function sitemap(): SitemapEntry[] {
  return buildSitemap({
    siteUrl: SITE_URL,
    routes: SENDERO_APP_PUBLIC_ROUTES,
    locales: SEO_LOCALES,
    defaultLocale: 'en-US',
  });
}
