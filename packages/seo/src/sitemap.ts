/**
 * Multi-locale sitemap builder.
 *
 * Returns an array shaped for Next.js `app/sitemap.ts`. Each route
 * emits one entry per locale plus a canonical entry, with hreflang
 * alternates so Google indexes the right locale per traveler.
 */

export type ChangeFrequency =
  | 'always'
  | 'hourly'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'yearly'
  | 'never';

export interface SitemapRoute {
  /** Path relative to the site origin (e.g. `/`, `/pricing`). */
  path: string;
  changeFrequency?: ChangeFrequency;
  priority?: number; // 0.0 – 1.0
  /** ISO date string; defaults to now. */
  lastModified?: string;
}

export interface SitemapEntry {
  url: string;
  lastModified: Date;
  changeFrequency: ChangeFrequency;
  priority: number;
  alternates?: { languages: Record<string, string> };
}

export interface BuildSitemapArgs {
  siteUrl: string;
  routes: SitemapRoute[];
  locales: readonly string[];
  /** Default locale — listed as canonical without a prefix. */
  defaultLocale: string;
}

export function buildSitemap(args: BuildSitemapArgs): SitemapEntry[] {
  const origin = trimTrailingSlash(args.siteUrl);
  const now = new Date();
  const entries: SitemapEntry[] = [];

  for (const route of args.routes) {
    const lastModified = route.lastModified ? new Date(route.lastModified) : now;
    const changeFrequency = route.changeFrequency ?? 'weekly';
    const priority = route.priority ?? 0.7;

    // hreflang alternates — include every locale, default as `x-default`.
    const languages: Record<string, string> = { 'x-default': `${origin}${route.path}` };
    for (const locale of args.locales) {
      const prefix = locale === args.defaultLocale ? '' : `/${locale}`;
      languages[locale] = `${origin}${prefix}${route.path === '/' ? '' : route.path}`;
    }

    // Default-locale canonical entry.
    entries.push({
      url: `${origin}${route.path}`,
      lastModified,
      changeFrequency,
      priority,
      alternates: { languages },
    });

    // One per non-default locale, hreflang-aligned.
    for (const locale of args.locales) {
      if (locale === args.defaultLocale) continue;
      const url = `${origin}/${locale}${route.path === '/' ? '' : route.path}`;
      entries.push({
        url,
        lastModified,
        changeFrequency,
        priority: Math.max(priority - 0.1, 0.1),
        alternates: { languages },
      });
    }
  }

  return entries;
}

function trimTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

/** Default route catalog for Sendero's marketing site. */
export const SENDERO_MARKETING_ROUTES: SitemapRoute[] = [
  { path: '/', changeFrequency: 'daily', priority: 1.0 },
  { path: '/pricing', changeFrequency: 'weekly', priority: 0.9 },
  { path: '/for-agencies', changeFrequency: 'weekly', priority: 0.8 },
  { path: '/for-corporate', changeFrequency: 'weekly', priority: 0.8 },
  { path: '/for-agents', changeFrequency: 'weekly', priority: 0.8 },
  { path: '/help', changeFrequency: 'weekly', priority: 0.6 },
  { path: '/blog', changeFrequency: 'daily', priority: 0.6 },
  { path: '/legal/privacy', changeFrequency: 'monthly', priority: 0.3 },
  { path: '/legal/terms', changeFrequency: 'monthly', priority: 0.3 },
];
