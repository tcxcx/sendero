import type { Viewport } from 'next';
import Script from 'next/script';

import { ClerkProvider } from '@clerk/nextjs';
import { SUPPORTED_LOCALES } from '@sendero/locale';
import {
  buildMetadata,
  organizationJsonLd,
  resolvePublicOrigin,
  softwareApplicationJsonLd,
  travelAgencyJsonLd,
} from '@sendero/seo';
import { Agentation } from 'agentation';
import { NuqsAdapter } from 'nuqs/adapters/next/app';

import { getRequestLocale } from '@/lib/request-locale';
import { Toaster } from '@sendero/ui/sonner';
import '@sendero/ui/globals.css';
import './globals.css';

const APP_URL = resolvePublicOrigin(process.env.NEXT_PUBLIC_APP_URL, 'https://app.sendero.travel');
const MARKETING_URL = resolvePublicOrigin(
  process.env.NEXT_PUBLIC_SITE_URL,
  'https://sendero.travel'
);
const VERCEL_DEPLOY_URL = process.env.VERCEL_URL
  ? resolvePublicOrigin(`https://${process.env.VERCEL_URL}`, APP_URL)
  : null;
/** Local dev must be allowed so OAuth / invite return URLs are not dropped. */
const CLERK_DEV_LOCAL = process.env.NODE_ENV === 'development' ? 'http://localhost:3010' : null;
const CLERK_ALLOWED_REDIRECT_ORIGINS = Array.from(
  new Set(
    [APP_URL, VERCEL_DEPLOY_URL, CLERK_DEV_LOCAL].filter((origin): origin is string =>
      Boolean(origin)
    )
  )
);
const CLERK_SIGN_IN_FALLBACK =
  process.env.NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL ??
  process.env.NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL ??
  '/app';
const CLERK_SIGN_UP_FALLBACK =
  process.env.NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL ??
  process.env.NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL ??
  '/onboarding';
const SEO_LOCALES = SUPPORTED_LOCALES;
const DESCRIPTION =
  'Sendero App is the control workspace for agent-native travel: prepaid traveler links, WhatsApp and Slack journeys, MCP tools, trips, invoices, spend controls, and Arc USDC settlement.';

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
    'agent-native travel app',
    'AI travel operations console',
    'prepaid traveler links',
    'WhatsApp travel agent',
    'Slack travel approvals',
    'Arc USDC settlement',
    'MCP travel tools',
    'travel invoices',
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
        {process.env.NODE_ENV === 'development' && (
          <Script
            src="https://unpkg.com/react-grab/dist/index.global.js"
            crossOrigin="anonymous"
            strategy="beforeInteractive"
          />
        )}
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
        <ClerkProvider
          signInUrl="/sign-in"
          signUpUrl="/sign-up"
          waitlistUrl="/waitlist"
          signInFallbackRedirectUrl={CLERK_SIGN_IN_FALLBACK}
          signUpFallbackRedirectUrl={CLERK_SIGN_UP_FALLBACK}
          allowedRedirectOrigins={CLERK_ALLOWED_REDIRECT_ORIGINS}
          {...clerkDevelopmentScriptPins}
        >
          <NuqsAdapter>
            {children}
            <Toaster />
          </NuqsAdapter>
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
