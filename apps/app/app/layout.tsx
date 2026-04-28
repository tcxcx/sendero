import type { Viewport } from 'next';
import Script from 'next/script';

import { ClerkProvider } from '@clerk/nextjs';
import { senderoClerkAppearance } from '@sendero/auth/clerk-appearance';
import { senderoFontVars } from '@sendero/fonts';
import { SUPPORTED_LOCALES } from '@sendero/locale';
import {
  buildClerkAllowedRedirectOrigins,
  buildMetadata,
  organizationJsonLd,
  resolvePublicOrigin,
  softwareApplicationJsonLd,
  travelAgencyJsonLd,
} from '@sendero/seo';
import { buildOgImageUrl } from '@sendero/seo/og';
import { Toaster } from '@sendero/ui/sonner';
import { Agentation } from 'agentation';
import { NuqsAdapter } from 'nuqs/adapters/next/app';

import { getRequestLocale } from '@/lib/request-locale';
import '@sendero/ui/globals.css';
import './globals.css';

const APP_URL = resolvePublicOrigin(process.env.NEXT_PUBLIC_APP_URL, 'https://app.sendero.travel');
const MARKETING_URL = resolvePublicOrigin(
  process.env.NEXT_PUBLIC_SITE_URL,
  'https://sendero.travel'
);
const CLERK_ALLOWED_REDIRECT_ORIGINS = buildClerkAllowedRedirectOrigins();
const CLERK_SIGN_IN_FALLBACK =
  process.env.NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL ??
  process.env.NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL ??
  '/dashboard';
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
  ogImage: buildOgImageUrl(APP_URL, {
    title: 'AI travel operations console',
    description:
      'Prepaid traveler links, WhatsApp + Slack journeys, MCP tools, invoices, spend controls, and Arc USDC settlement.',
    eyebrow: 'apps.sendero.travel',
  }),
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

const enableReactGrab =
  process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_ENABLE_REACT_GRAB === '1';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getRequestLocale();

  return (
    <html lang={locale} className={senderoFontVars}>
      <head>
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
        {enableReactGrab && (
          <Script
            src="https://unpkg.com/react-grab/dist/index.global.js"
            crossOrigin="anonymous"
            strategy="afterInteractive"
          />
        )}
        <ClerkProvider
          appearance={senderoClerkAppearance}
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
