import type { ReactNode } from 'react';

import { DocsLayout } from 'fumadocs-ui/layouts/docs';

import { source } from '@/lib/source';

/**
 * The brand row, language selector, top-nav links, and Get-API-key
 * CTA all live in `<DocsTopBar>` (mounted once at app/layout.tsx)
 * so they don't get crammed into the Fumadocs sidebar header.
 *
 * This layout configures only the sidebar tree + sensible defaults.
 * `nav={{ enabled: false }}` would hide Fumadocs' built-in top-bar
 * entirely; we leave it absent because Fumadocs renders the sidebar
 * brand-row inline with the tree at narrow viewports — letting it
 * stay (in a stripped-down form via docs-overrides.css) keeps the
 * mobile nav functional.
 */
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      tree={source.pageTree}
      sidebar={{
        defaultOpenLevel: 1,
      }}
    >
      {children}
    </DocsLayout>
  );
}
