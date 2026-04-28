import type { ReactNode } from 'react';

import type { Viewport } from 'next';
import Script from 'next/script';

import { senderoFontVars } from '@sendero/fonts';
import {
  buildClerkAllowedRedirectOrigins,
  buildMetadata,
  organizationJsonLd,
  resolvePublicOrigin,
  softwareApplicationJsonLd,
  travelAgencyJsonLd,
} from '@sendero/seo';
import { Agentation } from 'agentation';

import { SiteFooter } from '@/components/site-shell/site-footer';
import { SiteHeader } from '@/components/site-shell/site-header';

import { Providers } from './providers';
import './globals.css';

const SITE_URL = resolvePublicOrigin(process.env.NEXT_PUBLIC_SITE_URL, 'https://sendero.travel');
const CLERK_ALLOWED_REDIRECT_ORIGINS = buildClerkAllowedRedirectOrigins();
const SEO_LOCALES = ['en-US', 'es-MX', 'pt-BR', 'es-AR'] as const;
const DESCRIPTION =
  'Sendero turns travel requests into coordinated agent workflows: real inventory, policy checks, prepaid guest escrow, PNR issuance, USDC settlement on Arc, invoices, and trip support.';

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
    'USDC travel payments',
    'Circle Arc travel',
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
    <html lang="en" className={senderoFontVars}>
      <head>
        {process.env.NODE_ENV === 'development' && (
          <Script
            src="https://unpkg.com/react-grab/dist/index.global.js"
            crossOrigin="anonymous"
            strategy="beforeInteractive"
          />
        )}
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
        <Providers allowedRedirectOrigins={CLERK_ALLOWED_REDIRECT_ORIGINS}>
          {/*
            Shared marketing chrome. The home page (/) and every secondary
            route (/agents, /pricing, /policy, /terms, /updates) inherit
            this header + footer; pages render only their body in between.
          */}
          <div className="mk-root">
            <SiteHeader />
            {children}
            <SiteFooter />
          </div>
        </Providers>
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
