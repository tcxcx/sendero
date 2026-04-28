import { cookies, headers } from 'next/headers';

import { detectLocale, LOCALE_COOKIE_NAME, LOCALE_HEADER_NAME } from '@sendero/locale';
import { resolvePublicOrigin } from '@sendero/seo';

import { getMarketingContent } from '@/lib/content';

/**
 * SiteHeader — shared marketing nav. Mounted in apps/marketing/app/layout.tsx
 * so every route inherits the same brand mark + product links.
 *
 * Server component; reads locale once per request and pulls labels from
 * lib/content.ts. Pages don't render their own nav anymore.
 */
export async function SiteHeader() {
  const [hdrs, cookieStore] = await Promise.all([headers(), cookies()]);
  const locale = detectLocale({
    cookie: cookieStore.get(LOCALE_COOKIE_NAME)?.value,
    acceptLanguage:
      hdrs.get(LOCALE_HEADER_NAME) ?? hdrs.get('accept-language') ?? hdrs.get('x-vercel-ip-locale'),
    country: hdrs.get('x-vercel-ip-country') ?? hdrs.get('cf-ipcountry'),
  });
  const content = await getMarketingContent(locale);
  const appOrigin = resolvePublicOrigin(
    process.env.NEXT_PUBLIC_APP_URL,
    'https://app.sendero.travel'
  );

  return (
    <header className="mk-nav mk-nav-shared" aria-label="Sendero site header">
      <div className="mk-brand">
        <a href="/" aria-label="Sendero home" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <img
            alt=""
            className="mk-mark"
            decoding="async"
            src="/brand/logo-masters/clean/sendero_icon_vermilion_clean_2048.png"
          />
          <span>SENDERO</span>
          <span className="mk-x">·</span>
          <span>ARC</span>
        </a>
      </div>
      <div className="mk-nav-tools">
        <nav className="mk-nav-apps" aria-label="Sendero product navigation">
          <a href="/agents">Agents</a>
          <a href="/pricing">{content.nav.pricing ?? 'Pricing'}</a>
          <a href="/updates">Updates</a>
          <a href="https://docs.sendero.travel">Docs</a>
          <a href={appOrigin}>{content.nav.app}</a>
        </nav>
      </div>
    </header>
  );
}
