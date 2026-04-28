/**
 * DocsTopBar — global header for the docs site.
 *
 * Renders above the Fumadocs `<DocsLayout>` so the language selector
 * + nav + "Get API key" CTA live in a dedicated top strip instead of
 * being crammed into the sidebar header next to the brand mark.
 *
 * Layout: brand-left, nav-middle, language + API-key right.
 *
 * Auth-awareness without Clerk-in-docs: the "Get API key" button
 * routes to the Clerk-gated `/dashboard/settings/api-keys` on the
 * APP origin. If the user has a session, Clerk shows the page.
 * If not, Clerk's middleware bounces them to sign-in with a
 * `redirectUrl` back to the API keys page. Same UX as docs hosting
 * its own ClerkProvider, none of the runtime + bundle cost.
 *
 * In dev, NEXT_PUBLIC_APP_URL points the button at localhost:3010.
 * In prod, it points at app.sendero.travel.
 */

import { resolvePublicOrigin } from '@sendero/seo';
import { buildLocaleApiHrefs, SenderoLanguageSelector } from '@sendero/ui/language-selector';
import { ArrowUpRightIcon, BookOpenIcon, KeyIcon, PlayCircleIcon, PlugIcon, ZapIcon } from 'lucide-react';
import Link from 'next/link';

import { getDocsRequestLocale } from '@/lib/request-locale';

const APP_ORIGIN = resolvePublicOrigin(
  process.env.NEXT_PUBLIC_APP_URL,
  'https://app.sendero.travel'
);
const SITE_ORIGIN = resolvePublicOrigin(
  process.env.NEXT_PUBLIC_SITE_URL,
  'https://sendero.travel'
);

interface NavLink {
  label: string;
  href: string;
  icon: React.ReactNode;
  external?: boolean;
}

function buildNavLinks(): NavLink[] {
  return [
    {
      label: 'Agents',
      href: `${SITE_ORIGIN.replace(/\/$/, '')}/agents`,
      icon: <ZapIcon size={14} aria-hidden="true" />,
      external: true,
    },
    {
      label: 'Playground',
      href: `${APP_ORIGIN.replace(/\/$/, '')}/playground`,
      icon: <PlayCircleIcon size={14} aria-hidden="true" />,
      external: true,
    },
    {
      label: 'API reference',
      href: '/docs/api-reference',
      icon: <BookOpenIcon size={14} aria-hidden="true" />,
    },
    {
      label: 'MCP',
      href: '/docs/mcp-integration',
      icon: <PlugIcon size={14} aria-hidden="true" />,
    },
  ];
}

export async function DocsTopBar() {
  const locale = await getDocsRequestLocale();
  const links = buildNavLinks();
  const apiKeysHref = `${APP_ORIGIN.replace(/\/$/, '')}/dashboard/settings/api-keys`;

  return (
    <header className="docs-top-bar" role="banner">
      {/* Brand */}
      <Link href="/" className="docs-top-bar-brand" aria-label="Sendero docs home">
        <img
          alt=""
          decoding="async"
          src="/brand/logo-masters/clean/sendero_icon_vermilion_clean_2048.png"
          className="docs-top-bar-mark"
        />
        <span className="docs-top-bar-brand-text">
          <span style={{ color: 'var(--ink)' }}>Sendero</span>
          <span aria-hidden="true" style={{ color: 'var(--text-dim)' }}>
            {' / '}
          </span>
          <span>Docs</span>
        </span>
      </Link>

      {/* Primary nav. Hidden on narrow viewports — the Fumadocs sidebar
          covers in-docs navigation for mobile. */}
      <nav className="docs-top-bar-nav" aria-label="Sendero developer surfaces">
        {links.map((link) => (
          <Link
            key={link.label}
            href={link.href}
            target={link.external ? '_blank' : undefined}
            rel={link.external ? 'noreferrer' : undefined}
            className="docs-top-bar-nav-link"
          >
            <span className="docs-top-bar-nav-icon" aria-hidden="true">
              {link.icon}
            </span>
            {link.label}
            {link.external ? (
              <ArrowUpRightIcon
                size={11}
                aria-hidden="true"
                className="docs-top-bar-nav-ext"
              />
            ) : null}
          </Link>
        ))}
      </nav>

      {/* Right cluster — language + API key CTA */}
      <div className="docs-top-bar-right" aria-label="Locale and account">
        <SenderoLanguageSelector
          className="docs-top-bar-language is-compact"
          currentLocale={locale}
          hrefs={buildLocaleApiHrefs('/docs', { includeLocalizedPath: false })}
        />
        <Link
          href={apiKeysHref}
          className="docs-top-bar-cta"
          target="_blank"
          rel="noreferrer"
        >
          <KeyIcon size={13} aria-hidden="true" />
          <span>Get API key</span>
        </Link>
      </div>
    </header>
  );
}
