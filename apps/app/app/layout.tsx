import type { Viewport } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import { Agentation } from 'agentation';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import {
  buildMetadata,
  organizationJsonLd,
  softwareApplicationJsonLd,
  travelAgencyJsonLd,
} from '@sendero/seo';
import { ReactGrabLoader } from '@/components/react-grab-loader';
import { getRequestLocale } from '@/lib/request-locale';
import '@sendero/ui/globals.css';
import './globals.css';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.sendero.travel';
const MARKETING_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://sendero.travel';
const SEO_LOCALES = ['en-US'] as const;
const DESCRIPTION =
  'Sendero app is the tenant console for agent-native travel operations: trips, invoices, MCP tools, billing, policy caps, webhooks, and Arc USDC settlement.';

export const metadata = buildMetadata({
  title: 'Sendero App',
  titleSuffix: 'AI travel operations console',
  description: DESCRIPTION,
  path: '/',
  locale: 'en-US',
  locales: SEO_LOCALES,
  defaultLocale: 'en-US',
  siteUrl: APP_URL,
  siteName: 'Sendero App',
  ogImageAlt: 'Sendero app social preview for AI travel operations and booking workflows.',
  keywords: [
    'travel operations console',
    'AI travel workbench',
    'agent booking console',
    'tenant travel billing',
    'travel escrow',
    'Arc USDC settlement',
    'MCP travel tools',
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
      siteUrl: MARKETING_URL,
      logoUrl: `${APP_URL}/brand/seo/schema-logo-512.png`,
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

const clerkDevelopmentScriptPins =
  process.env.NODE_ENV === 'development'
    ? {
        __internal_clerkJSVersion: process.env.NEXT_PUBLIC_CLERK_JS_VERSION ?? '6.7.4',
        __internal_clerkUIVersion: process.env.NEXT_PUBLIC_CLERK_UI_VERSION ?? '1.6.2',
      }
    : {};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getRequestLocale();

  return (
    <html lang={locale}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
        <link rel="alternate" type="text/plain" title="Sendero App llms.txt" href="/llms.txt" />
        <link
          rel="alternate"
          type="text/plain"
          title="Sendero App well-known llms.txt"
          href="/.well-known/llms.txt"
        />
        <link rel="alternate" type="application/json" title="Sendero MCP" href="/api/mcp" />
        {structuredData.map(schema => (
          <JsonLd key={schema.id} data={schema.data} />
        ))}
      </head>
      <body>
        <ReactGrabLoader />
        <ClerkProvider
          signInUrl="/sign-in"
          signUpUrl="/sign-up"
          waitlistUrl="/waitlist"
          {...clerkDevelopmentScriptPins}
        >
          <NuqsAdapter>{children}</NuqsAdapter>
          {process.env.NODE_ENV === 'development' && <Agentation />}
        </ClerkProvider>
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
