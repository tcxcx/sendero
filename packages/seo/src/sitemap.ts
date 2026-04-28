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

export function serializeSitemap(entries: SitemapEntry[]): string {
  const urls = entries
    .map(entry => {
      const alternates = Object.entries(entry.alternates?.languages ?? {})
        .map(
          ([language, href]) =>
            `    <xhtml:link rel="alternate" hreflang="${escapeXml(language)}" href="${escapeXml(href)}" />`
        )
        .join('\n');

      return [
        '  <url>',
        `    <loc>${escapeXml(entry.url)}</loc>`,
        `    <lastmod>${entry.lastModified.toISOString()}</lastmod>`,
        `    <changefreq>${entry.changeFrequency}</changefreq>`,
        `    <priority>${entry.priority.toFixed(1)}</priority>`,
        alternates,
        '  </url>',
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls}\n</urlset>\n`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function trimTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

/** Default route catalog for Sendero's marketing site. */
export const SENDERO_MARKETING_ROUTES: SitemapRoute[] = [
  { path: '/', changeFrequency: 'daily', priority: 1.0 },
  { path: '/agents', changeFrequency: 'weekly', priority: 0.9 },
  { path: '/pricing', changeFrequency: 'weekly', priority: 0.85 },
  { path: '/updates', changeFrequency: 'weekly', priority: 0.8 },
  { path: '/policy', changeFrequency: 'monthly', priority: 0.5 },
  { path: '/terms', changeFrequency: 'monthly', priority: 0.5 },
  { path: '/llms.txt', changeFrequency: 'daily', priority: 0.95 },
  { path: '/.well-known/llms.txt', changeFrequency: 'daily', priority: 0.95 },
];

export const SENDERO_APP_PUBLIC_ROUTES: SitemapRoute[] = [
  { path: '/', changeFrequency: 'daily', priority: 1.0 },
  { path: '/llms.txt', changeFrequency: 'daily', priority: 0.95 },
  { path: '/.well-known/llms.txt', changeFrequency: 'daily', priority: 0.95 },
  { path: '/sign-in/unauthorized', changeFrequency: 'monthly', priority: 0.45 },
  { path: '/waitlist', changeFrequency: 'weekly', priority: 0.7 },
  { path: '/onboarding', changeFrequency: 'weekly', priority: 0.65 },
];

export const SENDERO_HELP_ROUTES: SitemapRoute[] = [
  { path: '/', changeFrequency: 'weekly', priority: 0.85 },
  { path: '/llms.txt', changeFrequency: 'daily', priority: 0.8 },
  { path: '/.well-known/llms.txt', changeFrequency: 'daily', priority: 0.8 },
  { path: '/article/what-is-sendero', changeFrequency: 'monthly', priority: 0.75 },
  { path: '/article/how-booking-works', changeFrequency: 'monthly', priority: 0.75 },
  { path: '/article/clerk-legal-express-consent', changeFrequency: 'monthly', priority: 0.72 },
  { path: '/article/whatsapp-link-token', changeFrequency: 'monthly', priority: 0.72 },
  { path: '/article/prepaid-escrow-links', changeFrequency: 'monthly', priority: 0.72 },
  { path: '/article/agency-whatsapp-prepaid-trips', changeFrequency: 'monthly', priority: 0.72 },
  { path: '/article/corporate-slack-approvals', changeFrequency: 'monthly', priority: 0.72 },
  { path: '/article/mcp-tool-catalog', changeFrequency: 'monthly', priority: 0.75 },
  { path: '/article/connect-another-agent', changeFrequency: 'monthly', priority: 0.75 },
  { path: '/article/nanopayment-pricing', changeFrequency: 'monthly', priority: 0.75 },
];

export const SENDERO_DOCS_ROUTES: SitemapRoute[] = [
  { path: '/', changeFrequency: 'weekly', priority: 0.85 },
  { path: '/docs', changeFrequency: 'weekly', priority: 0.9 },
  { path: '/llms.txt', changeFrequency: 'daily', priority: 0.85 },
  { path: '/.well-known/llms.txt', changeFrequency: 'daily', priority: 0.85 },
  { path: '/docs/quickstart', changeFrequency: 'weekly', priority: 0.85 },
  { path: '/docs/agent-to-agent-booking', changeFrequency: 'weekly', priority: 0.85 },
  { path: '/docs/mcp-integration', changeFrequency: 'weekly', priority: 0.82 },
  { path: '/docs/x402-nanopayments', changeFrequency: 'weekly', priority: 0.82 },
  { path: '/docs/tools/overview', changeFrequency: 'weekly', priority: 0.8 },
  { path: '/docs/tools/search_flights', changeFrequency: 'weekly', priority: 0.72 },
  { path: '/docs/tools/settle_split', changeFrequency: 'weekly', priority: 0.72 },
  { path: '/docs/pricing', changeFrequency: 'weekly', priority: 0.7 },
];

export const SENDERO_EDGE_ROUTES: SitemapRoute[] = [
  { path: '/', changeFrequency: 'hourly', priority: 0.8 },
  { path: '/llms.txt', changeFrequency: 'daily', priority: 0.9 },
  { path: '/.well-known/llms.txt', changeFrequency: 'daily', priority: 0.9 },
  { path: '/mcp', changeFrequency: 'daily', priority: 0.85 },
  { path: '/tools', changeFrequency: 'daily', priority: 0.8 },
];
