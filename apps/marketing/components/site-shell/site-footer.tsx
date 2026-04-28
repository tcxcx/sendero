import { cookies, headers } from 'next/headers';

import { detectLocale, LOCALE_COOKIE_NAME, LOCALE_HEADER_NAME } from '@sendero/locale';

import { getMarketingContent } from '@/lib/content';

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
        {(content.footer.groups ?? []).map((group) => (
          <div className="mk-foot-col" key={group.label}>
            <strong>{group.label}</strong>
            <nav aria-label={group.label}>
              {group.links.map((link) => (
                <a key={`${group.label}-${link.label}`} href={link.href}>
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
          {content.footer.links.map((link) => (
            <a key={link.href} href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>
      </div>
    </footer>
  );
}
