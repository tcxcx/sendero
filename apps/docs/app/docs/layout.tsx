import type { ReactNode } from 'react';

import { buildLocaleApiHrefs, SenderoLanguageSelector } from '@sendero/ui/language-selector';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';

import { getDocsRequestLocale } from '@/lib/request-locale';
import { source } from '@/lib/source';

export default async function Layout({ children }: { children: ReactNode }) {
  const locale = await getDocsRequestLocale();

  return (
    <DocsLayout
      tree={source.pageTree}
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
