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
  twitterHandle?: string;
  /** Append to the title, e.g. "Sendero — Corporate travel on Arc". */
  titleSuffix?: string;
}

export interface SenderoMetadata {
  title: string;
  description: string;
  metadataBase: URL;
  alternates: {
    canonical: string;
    languages: Record<string, string>;
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
}

export function buildMetadata(args: MetadataArgs): SenderoMetadata {
  const origin = trimTrailingSlash(args.siteUrl);
  const localizedPath =
    args.locale === args.defaultLocale
      ? args.path
      : `/${args.locale}${args.path === '/' ? '' : args.path}`;
  const canonical = `${origin}${localizedPath}`;
  const title = args.titleSuffix ? `${args.title} — ${args.titleSuffix}` : args.title;

  const languages: Record<string, string> = { 'x-default': `${origin}${args.path}` };
  for (const locale of args.locales) {
    const prefix = locale === args.defaultLocale ? '' : `/${locale}`;
    languages[locale] = `${origin}${prefix}${args.path === '/' ? '' : args.path}`;
  }

  return {
    title,
    description: args.description,
    metadataBase: new URL(origin),
    alternates: { canonical, languages },
    openGraph: {
      title,
      description: args.description,
      url: canonical,
      siteName: args.siteName,
      images: args.ogImage
        ? [{ url: args.ogImage, width: 1200, height: 630, alt: args.title }]
        : undefined,
      locale: args.locale,
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description: args.description,
      images: args.ogImage ? [args.ogImage] : undefined,
      creator: args.twitterHandle,
    },
  };
}

function trimTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}
