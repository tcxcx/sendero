/**
 * Typed metadata builders producing Next.js `Metadata` objects.
 *
 * All helpers take a `locale` argument and fill in `alternates.languages`
 * automatically so `<link rel="alternate" hreflang>` ships on every page.
 */

export interface MetadataArgs {
  title: string;
  description: string;
  path: string;
  locale: string;
  locales: readonly string[];
  defaultLocale: string;
  siteUrl: string;
  siteName?: string;
  ogImage?: string;
  ogImageAlt?: string;
  twitterImage?: string;
  twitterHandle?: string;
  keywords?: string[];
  category?: string;
  /** Append to the title, e.g. "Sendero — Corporate travel on Arc". */
  titleSuffix?: string;
}

export const SENDERO_SEO_ASSETS = {
  favicon: '/favicon.ico',
  favicon16: '/favicon-16x16.png',
  favicon32: '/favicon-32x32.png',
  favicon48: '/favicon-48x48.png',
  favicon64: '/favicon-64x64.png',
  appleTouchIcon: '/apple-touch-icon.png',
  androidChrome192: '/android-chrome-192x192.png',
  androidChrome512: '/android-chrome-512x512.png',
  appIcon: '/brand/seo/app-icon-store-ready-1024.png',
  appIconTransparent: '/brand/seo/app-icon-transparent-1024.png',
  schemaLogo: '/brand/seo/schema-logo-512.png',
  schemaLogoSmall: '/brand/seo/schema-logo-112.png',
  openGraph: '/brand/seo/open-graph-1200x630.png',
  xCard: '/brand/seo/x-card-1600x800.png',
  googleDiscover: '/brand/seo/google-discover-1600x900.png',
  xHeader: '/brand/seo/x-header-1500x500.png',
} as const;

export const SENDERO_DEFAULT_KEYWORDS = [
  'Sendero',
  'AI travel agent',
  'agent-native travel',
  'travel booking AI',
  'corporate travel',
  'travel agency AI',
  'MCP travel tools',
  'llms.txt',
  'Circle Arc',
  'USDC settlement',
  'Duffel flights',
];

export interface SenderoMetadata {
  title: string;
  description: string;
  applicationName: string;
  authors: Array<{ name: string; url?: string }>;
  creator: string;
  publisher: string;
  keywords: string[];
  category?: string;
  metadataBase: URL;
  manifest: string;
  alternates: {
    canonical: string;
    languages: Record<string, string>;
  };
  robots: {
    index: boolean;
    follow: boolean;
    googleBot: {
      index: boolean;
      follow: boolean;
      'max-image-preview': 'large';
      'max-snippet': number;
      'max-video-preview': number;
    };
  };
  icons: {
    icon: Array<{ url: string; sizes?: string; type?: string }>;
    shortcut: string;
    apple: Array<{ url: string; sizes: string; type: string }>;
    other: Array<{ rel: string; url: string; sizes?: string; type?: string }>;
  };
  openGraph: {
    title: string;
    description: string;
    url: string;
    siteName?: string;
    images?: Array<{ url: string; width: number; height: number; alt: string }>;
    locale: string;
    type: 'website';
  };
  twitter: {
    card: 'summary_large_image';
    title: string;
    description: string;
    images?: string[];
    creator?: string;
  };
  other: Record<string, string>;
}

export function buildMetadata(args: MetadataArgs): SenderoMetadata {
  const origin = trimTrailingSlash(args.siteUrl);
  const localizedPath =
    args.locale === args.defaultLocale
      ? args.path
      : `/${args.locale}${args.path === '/' ? '' : args.path}`;
  const canonical = `${origin}${localizedPath}`;
  const title = args.titleSuffix ? `${args.title} — ${args.titleSuffix}` : args.title;
  const ogImage = args.ogImage ?? SENDERO_SEO_ASSETS.openGraph;
  const twitterImage = args.twitterImage ?? SENDERO_SEO_ASSETS.xCard;
  const imageAlt = args.ogImageAlt ?? `${args.title} social preview`;

  const languages: Record<string, string> = { 'x-default': `${origin}${args.path}` };
  for (const locale of args.locales) {
    const prefix = locale === args.defaultLocale ? '' : `/${locale}`;
    languages[locale] = `${origin}${prefix}${args.path === '/' ? '' : args.path}`;
  }

  return {
    title,
    description: args.description,
    applicationName: args.siteName ?? 'Sendero',
    authors: [{ name: 'Sendero', url: origin }],
    creator: 'Sendero',
    publisher: 'Sendero',
    keywords: [...SENDERO_DEFAULT_KEYWORDS, ...(args.keywords ?? [])],
    category: args.category,
    metadataBase: new URL(origin),
    manifest: '/manifest.webmanifest',
    alternates: { canonical, languages },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        'max-image-preview': 'large',
        'max-snippet': -1,
        'max-video-preview': -1,
      },
    },
    icons: {
      icon: [
        { url: SENDERO_SEO_ASSETS.favicon, sizes: 'any' },
        { url: SENDERO_SEO_ASSETS.favicon16, sizes: '16x16', type: 'image/png' },
        { url: SENDERO_SEO_ASSETS.favicon32, sizes: '32x32', type: 'image/png' },
        { url: SENDERO_SEO_ASSETS.favicon48, sizes: '48x48', type: 'image/png' },
        { url: SENDERO_SEO_ASSETS.favicon64, sizes: '64x64', type: 'image/png' },
        {
          url: SENDERO_SEO_ASSETS.androidChrome192,
          sizes: '192x192',
          type: 'image/png',
        },
        {
          url: SENDERO_SEO_ASSETS.androidChrome512,
          sizes: '512x512',
          type: 'image/png',
        },
      ],
      shortcut: SENDERO_SEO_ASSETS.favicon,
      apple: [{ url: SENDERO_SEO_ASSETS.appleTouchIcon, sizes: '180x180', type: 'image/png' }],
      other: [],
    },
    openGraph: {
      title,
      description: args.description,
      url: canonical,
      siteName: args.siteName,
      images: [{ url: ogImage, width: 1200, height: 630, alt: imageAlt }],
      locale: args.locale,
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description: args.description,
      images: [twitterImage],
      creator: args.twitterHandle,
    },
    other: {
      'llms-txt': `${origin}/llms.txt`,
      'agent-manifest': `${origin}/.well-known/llms.txt`,
      'google-discover-image': `${origin}${SENDERO_SEO_ASSETS.googleDiscover}`,
    },
  };
}

function trimTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}
