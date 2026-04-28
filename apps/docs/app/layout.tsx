import type { ReactNode } from 'react';

import type { Viewport } from 'next';
import Script from 'next/script';

import { senderoFontVars } from '@sendero/fonts';
import {
  buildMetadata,
  organizationJsonLd,
  resolvePublicOrigin,
  softwareApplicationJsonLd,
  travelAgencyJsonLd,
} from '@sendero/seo';
import { buildOgImageUrl } from '@sendero/seo/og';
import 'fumadocs-ui/style.css';

import { DocsRootProvider } from '@/app/docs-root-provider';
import { DocsTopBar } from '@/components/docs-top-bar';

// Pull the exact same token vocabulary the main Sendero app uses so
// the docs match the vermilion brand pixel-for-pixel. The relative
// path is intentional — we do NOT duplicate the stylesheet.
import '../../app/app/globals.css';
import './docs-overrides.css';

const DOCS_URL = resolvePublicOrigin(
  process.env.NEXT_PUBLIC_DOCS_URL,
  'https://docs.sendero.travel'
);
const MARKETING_URL = resolvePublicOrigin(
  process.env.NEXT_PUBLIC_SITE_URL,
  'https://sendero.travel'
);
const SEO_LOCALES = ['en-US'] as const;
const DESCRIPTION =
  'Developer docs for Sendero: MCP travel tools, x402 nanopayments, Arc settlement, Duffel booking flows, and agent-to-agent travel orchestration.';

export const metadata = buildMetadata({
  title: 'Sendero Developer Docs',
  titleSuffix: 'MCP travel tools and x402 nanopayments',
  description: DESCRIPTION,
  path: '/',
  locale: 'en-US',
  locales: SEO_LOCALES,
  defaultLocale: 'en-US',
  siteUrl: DOCS_URL,
  siteName: 'Sendero Developer Docs',
  ogImage: buildOgImageUrl(DOCS_URL, {
    title: 'Developer Docs',
    description:
      'MCP travel tools, x402 nanopayments, Arc settlement, Duffel booking flows, and agent-to-agent travel orchestration.',
    eyebrow: 'docs.sendero.travel',
  }),
  ogImageAlt: 'Sendero developer docs social preview for MCP travel tools.',
  keywords: [
    'Sendero API',
    'travel MCP server',
    'MCP tool catalog',
    'x402 nanopayments',
    'agent-to-agent booking',
    'Arc settlement',
    'Duffel API docs',
  ],
  category: 'Developer Documentation',
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
      logoUrl: `${DOCS_URL}/brand/seo/schema-logo-512.png`,
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
    <html lang="en" className={senderoFontVars} suppressHydrationWarning>
      <head>
        {process.env.NODE_ENV === 'development' && (
          <Script
            src="//unpkg.com/react-grab/dist/index.global.js"
            crossOrigin="anonymous"
            strategy="beforeInteractive"
          />
        )}
        <link
          rel="alternate"
          type="text/plain"
          title="Sendero Developer Docs llms.txt"
          href="/llms.txt"
        />
        <link
          rel="alternate"
          type="text/plain"
          title="Sendero Developer Docs well-known llms.txt"
          href="/.well-known/llms.txt"
        />
        {structuredData.map(schema => (
          <JsonLd key={schema.id} data={schema.data} />
        ))}
      </head>
      <body>
        <DocsRootProvider>
          {/*
            DocsTopBar replaces the language selector + nav links that
            Fumadocs would otherwise cram into the sidebar header.
            Mounted once at the root so every docs route inherits the
            same top strip (brand-left, nav-middle, language +
            Get-API-key right). See apps/docs/components/docs-top-bar.tsx.
          */}
          <DocsTopBar />
          {children}
        </DocsRootProvider>
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
