import type { Viewport } from 'next';
import type { ReactNode } from 'react';
import {
  buildMetadata,
  organizationJsonLd,
  resolvePublicOrigin,
  softwareApplicationJsonLd,
  travelAgencyJsonLd,
} from '@sendero/seo';
import './globals.css';

const HELP_URL = resolvePublicOrigin(
  process.env.NEXT_PUBLIC_HELP_URL,
  'https://help.sendero.travel'
);
const MARKETING_URL = resolvePublicOrigin(
  process.env.NEXT_PUBLIC_SITE_URL,
  'https://sendero.travel'
);
const SEO_LOCALES = ['en-US'] as const;
const DESCRIPTION =
  'Help and troubleshooting for Sendero: traveler booking support, agency deployment, corporate travel operations, MCP tools, and AI-agent handoffs.';

export const metadata = buildMetadata({
  title: 'Sendero Help Center',
  titleSuffix: 'AI travel support',
  description: DESCRIPTION,
  path: '/',
  locale: 'en-US',
  locales: SEO_LOCALES,
  defaultLocale: 'en-US',
  siteUrl: HELP_URL,
  siteName: 'Sendero Help',
  ogImageAlt: 'Sendero Help Center social preview for AI travel support.',
  keywords: [
    'Sendero support',
    'AI travel help',
    'MCP travel support',
    'travel booking troubleshooting',
    'agency travel support',
    'corporate travel help',
    'nanopayment pricing help',
  ],
  category: 'Help Center',
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#cc4b37',
};

const structuredData = [
  {
    id: 'organization',
    data: organizationJsonLd({
      siteUrl: MARKETING_URL,
      logoUrl: `${HELP_URL}/brand/seo/schema-logo-512.png`,
      supportedLanguages: ['en', 'es', 'pt'],
    }),
  },
  {
    id: 'travel-agency',
    data: travelAgencyJsonLd({
      siteUrl: MARKETING_URL,
      description: DESCRIPTION,
    }),
  },
  { id: 'software-application', data: softwareApplicationJsonLd({}) },
];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="alternate" type="text/plain" title="Sendero Help llms.txt" href="/llms.txt" />
        <link
          rel="alternate"
          type="text/plain"
          title="Sendero Help well-known llms.txt"
          href="/.well-known/llms.txt"
        />
        {structuredData.map(schema => (
          <JsonLd key={schema.id} data={schema.data} />
        ))}
      </head>
      <body>{children}</body>
    </html>
  );
}

function JsonLd({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }}
    />
  );
}
