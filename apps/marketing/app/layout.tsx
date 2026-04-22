import type { Viewport } from 'next';
import type { ReactNode } from 'react';
import { Agentation } from 'agentation';
import {
  buildMetadata,
  organizationJsonLd,
  softwareApplicationJsonLd,
  travelAgencyJsonLd,
} from '@sendero/seo';
import { Providers } from './providers';
import './globals.css';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://sendero.travel';
const SEO_LOCALES = ['en-US'] as const;
const DESCRIPTION =
  'AI travel agents that live where your customers already are. One agent per trip, reachable over WhatsApp, Slack, email, and MCP. Real PNRs via Duffel. Settled in USDC on Arc.';

export const metadata = buildMetadata({
  title: 'Sendero',
  titleSuffix: 'Agent-native travel, settled on Arc',
  description: DESCRIPTION,
  path: '/',
  locale: 'en-US',
  locales: SEO_LOCALES,
  defaultLocale: 'en-US',
  siteUrl: SITE_URL,
  siteName: 'Sendero',
  ogImageAlt: 'Sendero social preview with the binoculars mark and agent-native travel copy.',
  keywords: [
    'AI travel booking',
    'travel agent platform',
    'corporate travel AI',
    'travel agency automation',
    'WhatsApp travel agent',
    'MCP travel server',
    'x402 travel tools',
  ],
  category: 'Travel Technology',
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
      siteUrl: SITE_URL,
      logoUrl: `${SITE_URL}/brand/seo/schema-logo-512.png`,
      supportedLanguages: ['en', 'es', 'pt'],
    }),
  },
  {
    id: 'travel-agency',
    data: travelAgencyJsonLd({
      siteUrl: SITE_URL,
      description: DESCRIPTION,
    }),
  },
  { id: 'software-application', data: softwareApplicationJsonLd({}) },
];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="alternate" type="text/plain" title="Sendero llms.txt" href="/llms.txt" />
        <link
          rel="alternate"
          type="text/plain"
          title="Sendero well-known llms.txt"
          href="/.well-known/llms.txt"
        />
        {structuredData.map(schema => (
          <JsonLd key={schema.id} data={schema.data} />
        ))}
      </head>
      <body>
        <Providers>{children}</Providers>
        {process.env.NODE_ENV === 'development' && <Agentation />}
      </body>
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
