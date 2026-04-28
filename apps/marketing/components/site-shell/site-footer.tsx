import { cookies, headers } from 'next/headers';

import { detectLocale, LOCALE_COOKIE_NAME, LOCALE_HEADER_NAME } from '@sendero/locale';
import { resolvePublicOrigin } from '@sendero/seo';

import { getMarketingContent } from '@/lib/content';

/**
 * Map every Sendero subdomain link in the footer to the right origin
 * for the current env. In prod that's the deployed origin; in dev it
 * collapses to the localhost port we run each surface on.
 *
 * Keeps `lib/content.ts` agnostic — it can keep storing the canonical
 * prod URLs and we rewrite at render time.
 */
function rewriteOrigin(
  href: string,
  appOrigin: string,
  docsOrigin: string,
  helpOrigin: string
): string {
  if (href.startsWith('https://app.sendero.travel')) {
    return href.replace('https://app.sendero.travel', appOrigin);
  }
  if (href.startsWith('https://docs.sendero.travel')) {
    return href.replace('https://docs.sendero.travel', docsOrigin);
  }
  if (href.startsWith('https://help.sendero.travel')) {
    return href.replace('https://help.sendero.travel', helpOrigin);
  }
  if (href.startsWith('/dashboard') || href.startsWith('/onboarding')) {
    return `${appOrigin.replace(/\/$/, '')}${href}`;
  }
  return href;
}

/**
 * SiteFooter — shared marketing footer. Mounted in app/layout.tsx so
 * every route inherits the same group columns + bottom-bar links.
 *
 * Locale-aware via the same detection chain SiteHeader uses.
 */
export async function SiteFooter() {
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
  const docsOrigin = resolvePublicOrigin(
    process.env.NEXT_PUBLIC_DOCS_URL,
    'https://docs.sendero.travel'
  );
  const helpOrigin = resolvePublicOrigin(
    process.env.NEXT_PUBLIC_HELP_URL,
    'https://help.sendero.travel'
  );
  const rewrite = (href: string): string => rewriteOrigin(href, appOrigin, docsOrigin, helpOrigin);

  return (
    <footer className="mk-foot mk-foot-shared">
      <div className="mk-foot-grid">
        <div className="mk-foot-brand">
          <div className="mk-brand mk-foot-brand-row">
            <img
              alt=""
              className="mk-mark"
              decoding="async"
              src="/brand/logo-masters/clean/sendero_icon_vermilion_clean_2048.png"
            />
            <span>SENDERO</span>
            <span className="mk-x">·</span>
            <span>ARC</span>
          </div>
          <p className="mk-foot-tagline">{content.hero.subtitle}</p>
        </div>
        {(content.footer.groups ?? []).map(group => (
          <div className="mk-foot-col" key={group.label}>
            <strong>{group.label}</strong>
            <nav aria-label={group.label}>
              {group.links.map(link => (
                <a key={`${group.label}-${link.label}`} href={rewrite(link.href)}>
                  {link.label}
                </a>
              ))}
            </nav>
          </div>
        ))}
      </div>
      <div className="mk-foot-bottom">
        <span>{content.footer.copyright}</span>
        <nav className="mk-foot-bottom-links" aria-label="Quick links">
          {content.footer.links.map(link => (
            <a key={link.href} href={rewrite(link.href)}>
              {link.label}
            </a>
          ))}
        </nav>
      </div>
    </footer>
  );
}
