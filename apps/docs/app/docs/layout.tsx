import type { ReactNode } from 'react';

import { buildLocaleApiHrefs, SenderoLanguageSelector } from '@sendero/ui/language-selector';
import { DocsLayout, type LinkItemType } from 'fumadocs-ui/layouts/docs';
import { BookOpenIcon, KeyIcon, PlugIcon } from 'lucide-react';

import { getDocsRequestLocale } from '@/lib/request-locale';
import { source } from '@/lib/source';

/**
 * Top-nav links — Stripe / Sherpa pattern, one click past their gated form.
 *
 *   API Reference → embedded Scalar viewer against /api/openapi.json.
 *   MCP           → /docs/mcp-integration with /api/mcp config snippets.
 *   Get API key   → deep link to the Clerk-native API-key UI inside the
 *                   app. No form, no waiting, no sales call.
 */
const TOP_NAV_LINKS: LinkItemType[] = [
  {
    type: 'main',
    text: 'API Reference',
    url: '/docs/api-reference',
    icon: <BookOpenIcon className="size-3.5" aria-hidden="true" />,
  },
  {
    type: 'main',
    text: 'MCP',
    url: '/docs/mcp-integration',
    icon: <PlugIcon className="size-3.5" aria-hidden="true" />,
  },
  {
    type: 'main',
    text: 'Get API key',
    url: 'https://www.sendero.travel/dashboard/settings/api-keys',
    external: true,
    icon: <KeyIcon className="size-3.5" aria-hidden="true" />,
  },
];

export default async function Layout({ children }: { children: ReactNode }) {
  const locale = await getDocsRequestLocale();

  return (
    <DocsLayout
      tree={source.pageTree}
      links={TOP_NAV_LINKS}
      nav={{
        title: (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            <img
              alt=""
              decoding="async"
              src="/brand/logo-masters/clean/sendero_icon_vermilion_clean_2048.png"
              style={{ width: 22, height: 22, objectFit: 'contain', flexShrink: 0 }}
            />
            <span style={{ color: 'var(--ink)' }}>Sendero</span> / docs
          </span>
        ),
        children: (
          <SenderoLanguageSelector
            className="docs-layout-language"
            currentLocale={locale}
            hrefs={buildLocaleApiHrefs('/docs', { includeLocalizedPath: false })}
          />
        ),
      }}
      sidebar={{
        defaultOpenLevel: 1,
      }}
    >
      {children}
    </DocsLayout>
  );
}
