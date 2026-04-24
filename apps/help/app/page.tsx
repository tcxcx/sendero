import { DEFAULT_LOCALE, getLocaleDisplayName, normalizeLocale } from '@sendero/locale';
import {
  buildLocaleApiHrefs,
  localizedLocalePath,
  SenderoLanguageSelector,
} from '@sendero/ui/language-selector';

import type { HelpArticle, HelpContent } from '@/lib/articles';
import { getHelpContent } from '@/lib/articles';
import { getRequestLocale } from '@/lib/request-locale';

export const revalidate = 300;

export default async function HelpHome() {
  const locale = await getRequestLocale();
  return <HelpHomeForLocale locale={locale} />;
}

export async function HelpHomeForLocale({ locale }: { locale: string }) {
  const content = await getHelpContent(locale);
  const normalized = normalizeLocale(content.locale) ?? DEFAULT_LOCALE;
  const homeHref = localizedPath(normalized, '/');

  return (
    <main className="hp-root">
      <header className="hp-nav">
        <a className="hp-brand" href={homeHref}>
          <img
            alt=""
            className="hp-mark"
            decoding="async"
            src="/brand/logo-masters/clean/sendero_icon_vermilion_clean_2048.png"
          />
          <span>SENDERO</span>
          <span className="hp-x">·</span>
          <span>HELP</span>
        </a>
        <div className="hp-nav-tools">
          <nav className="hp-nav-right" aria-label="Sendero help navigation">
            <a href="https://sendero.travel">{content.nav.website}</a>
            <a href="https://sendero-arc-web.vercel.app">{content.nav.app}</a>
            <a href="/llms.txt">{content.nav.agents}</a>
          </nav>
          <LocaleSelector
            canonicalPath="/"
            currentLocale={normalized}
            label={content.nav.language}
          />
        </div>
      </header>

      <section className="hp-hero">
        <div className="hp-hero-copy">
          <div className="hp-eyebrow">
            {content.hero.eyebrow} · {getLocaleDisplayName(normalized)}
          </div>
          <h1>{content.hero.title}</h1>
          <p>{content.hero.body}</p>
        </div>
        <figure className="hp-hero-visual">
          <img
            alt={content.hero.imageAlt}
            decoding="async"
            src="/brand/generated/agent-handoff-map.jpg"
          />
          <figcaption>{content.hero.imageCaption}</figcaption>
        </figure>
      </section>

      <section className="hp-route-strip" aria-label={content.routeStrip.ariaLabel}>
        {content.routeStrip.visuals.map(visual => (
          <figure className="hp-route" key={visual.label}>
            <img alt={visual.alt} decoding="async" src={visual.image} />
            <figcaption>
              <span>{visual.label}</span>
              <strong>{visual.title}</strong>
              <p>{visual.body}</p>
            </figcaption>
          </figure>
        ))}
      </section>

      <section className="hp-categories">
        {content.categories.map(cat => {
          const count = content.articles.filter(article => article.category === cat.id).length;
          return (
            <a key={cat.id} href={`#${cat.id}`} className="hp-cat">
              <div className="hp-cat-title">{cat.title}</div>
              <div className="hp-cat-desc">{cat.description}</div>
              <div className="hp-cat-count">
                {count} {count === 1 ? content.articleList.singular : content.articleList.plural}
              </div>
            </a>
          );
        })}
      </section>

      <section className="hp-section" aria-labelledby="hp-all-articles">
        <h2 id="hp-all-articles">{content.articleList.heading}</h2>
        <div className="hp-article-groups">
          {content.categories.map(category => {
            const categoryArticles = content.articles.filter(
              article => article.category === category.id
            );
            if (categoryArticles.length === 0) return null;

            return (
              <section className="hp-article-group" id={category.id} key={category.id}>
                <h3>{category.title}</h3>
                <ul className="hp-list">
                  {categoryArticles.map(article => (
                    <li key={article.slug}>
                      <a
                        href={localizedPath(normalized, `/article/${article.slug}`)}
                        className="hp-art"
                      >
                        <span className="hp-art-title">{article.title}</span>
                        <span className="hp-art-excerpt">{article.excerpt}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </section>

      <style>{inlineCss}</style>
    </main>
  );
}

export function LocaleSelector({
  canonicalPath,
  currentLocale,
  label,
}: {
  canonicalPath: string;
  currentLocale: string;
  label: string;
}) {
  return (
    <SenderoLanguageSelector
      currentLocale={currentLocale}
      hrefs={buildLocaleApiHrefs(canonicalPath)}
      label={label}
    />
  );
}

export function localizedPath(locale: string, canonicalPath: string): string {
  return localizedLocalePath(locale, canonicalPath);
}

export function formattedDate(date: string, locale: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const calendarDate = year && month && day ? new Date(year, month - 1, day) : new Date(date);

  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(calendarDate);
}

export function categoryTitle(content: HelpContent, article: HelpArticle): string {
  return (
    content.categories.find(category => category.id === article.category)?.title ?? article.category
  );
}

const inlineCss = `
  .hp-root { --hp-ease-out: cubic-bezier(0.23, 1, 0.32, 1); max-width: 1120px; margin: 0 auto; padding: 32px 24px 80px; }
  .hp-nav { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; font-family: var(--mono); font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; padding: 8px 0 48px; border-bottom: 1px solid var(--border); animation: hpNavIn 460ms var(--hp-ease-out) both; }
  .hp-brand { display: inline-flex; align-items: center; gap: 8px; color: var(--fg); text-decoration: none; }
  .hp-mark { display: inline-block; width: 28px; height: 28px; object-fit: contain; flex-shrink: 0; }
  .hp-x { opacity: 0.4; }
  .hp-nav-tools { display: flex; align-items: flex-start; justify-content: flex-end; gap: 22px; min-width: 0; }
  .hp-nav-right { display: inline-flex; gap: 16px; padding-top: 7px; }
  .hp-hero { display: grid; grid-template-columns: minmax(0, 0.78fr) minmax(320px, 1.22fr); gap: clamp(24px, 4vw, 44px); align-items: end; padding: 56px 0 32px; }
  .hp-hero-copy { padding-bottom: 10px; }
  .hp-hero-copy > * { animation: hpHeroCopyIn 560ms var(--hp-ease-out) both; }
  .hp-hero-copy > *:nth-child(2) { animation-delay: 65ms; }
  .hp-hero-copy > *:nth-child(3) { animation-delay: 120ms; }
  .hp-eyebrow { font-family: var(--mono); font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); margin-bottom: 16px; }
  .hp-hero h1 { font-size: clamp(32px, 4.5vw, 48px); letter-spacing: -0.025em; margin: 0 0 16px; font-weight: 500; }
  .hp-hero p { font-size: 17px; color: var(--muted); max-width: 560px; margin: 0; }
  .hp-hero-visual { margin: 0; min-width: 0; animation: hpHeroImageIn 720ms var(--hp-ease-out) 120ms both; }
  .hp-hero-visual img { display: block; width: 100%; aspect-ratio: 1.6; object-fit: cover; object-position: center; border: 1px solid var(--border); background: #eedcc7; filter: saturate(0.98) contrast(0.98); transition: filter 220ms var(--hp-ease-out), transform 520ms var(--hp-ease-out); }
  .hp-hero-visual:hover img { filter: saturate(1.03) contrast(1); transform: scale(1.012); }
  .hp-hero-visual figcaption { margin-top: 10px; font-family: var(--mono); font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); }
  .hp-route-strip { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 24px 0 54px; }
  .hp-route { display: grid; align-content: start; gap: 12px; min-width: 0; margin: 0; }
  .hp-route img { display: block; width: 100%; aspect-ratio: 1.75; object-fit: cover; object-position: center; border: 1px solid var(--border); background: #eedcc7; transition: filter 220ms var(--hp-ease-out), transform 420ms var(--hp-ease-out); }
  .hp-route:hover img { filter: saturate(1.04) contrast(1); transform: translateY(-2px); }
  .hp-route figcaption { display: grid; gap: 5px; }
  .hp-route figcaption span { font-family: var(--mono); font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent); }
  .hp-route figcaption strong { font-size: 15px; line-height: 1.2; font-weight: 500; }
  .hp-route figcaption p { margin: 0; font-size: 13px; line-height: 1.5; color: var(--muted); }
  .hp-categories { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 0; margin: 48px 0; border-top: 1px solid var(--border); border-left: 1px solid var(--border); }
  .hp-cat { display: block; padding: 24px; background: var(--bg); border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); text-decoration: none; transition: background 180ms var(--hp-ease-out), color 180ms var(--hp-ease-out), border-color 180ms var(--hp-ease-out), transform 160ms var(--hp-ease-out); }
  .hp-cat:hover { background: var(--ink); color: #fff; border-color: var(--ink); text-decoration: none; }
  .hp-cat:active { transform: scale(0.99); }
  .hp-cat:hover .hp-cat-desc,
  .hp-cat:hover .hp-cat-count { color: color-mix(in oklab, white 74%, var(--accent)); }
  .hp-cat-title { font-size: 18px; font-weight: 500; letter-spacing: -0.01em; margin-bottom: 6px; }
  .hp-cat-desc { font-size: 14px; color: var(--muted); margin-bottom: 12px; transition: color 180ms ease; }
  .hp-cat-count { font-family: var(--mono); font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); transition: color 180ms ease; }
  .hp-section { margin-top: 48px; }
  .hp-section h2 { font-family: var(--mono); font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); margin: 0 0 16px; }
  .hp-article-groups { display: grid; gap: 30px; }
  .hp-article-group { scroll-margin-top: 28px; }
  .hp-article-group h3 { font-size: 20px; font-weight: 500; letter-spacing: -0.01em; margin: 0 0 12px; }
  .hp-list { list-style: none; padding: 0; margin: 0; border-top: 1px solid var(--border); }
  .hp-art { display: flex; flex-direction: column; gap: 6px; padding: 16px 0; border-bottom: 1px solid var(--border); }
  .hp-art:hover { text-decoration: none; }
  .hp-art:hover .hp-art-title { text-decoration: underline; }
  .hp-art-title { font-size: 16px; font-weight: 500; letter-spacing: -0.01em; }
  .hp-art-excerpt { font-size: 14px; color: var(--muted); }
  @keyframes hpNavIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes hpHeroCopyIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes hpHeroImageIn { from { opacity: 0; transform: translateY(12px) scale(0.992); } to { opacity: 1; transform: translateY(0) scale(1); } }
  @supports (animation-timeline: view()) {
    .hp-route,
    .hp-cat,
    .hp-article-group {
      animation: hpSectionIn 620ms var(--hp-ease-out) both;
      animation-range: entry 0% cover 24%;
      animation-timeline: view();
      opacity: 0;
      transform: translateY(12px);
    }
  }
  @keyframes hpSectionIn { to { opacity: 1; transform: translateY(0); } }
  @media (max-width: 780px) {
    .hp-nav { flex-direction: column; align-items: stretch; gap: 18px; padding-bottom: 34px; }
    .hp-nav-tools { align-items: stretch; flex-direction: column; gap: 14px; }
    .hp-nav-right { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; width: 100%; padding-top: 0; }
    .hp-nav-right a { display: flex; min-height: 40px; align-items: center; justify-content: center; border: 1px solid var(--border); padding: 8px 10px; text-align: center; line-height: 1.15; text-decoration: none; }
    .hp-nav-right a:last-child { grid-column: 1 / -1; }
    .hp-hero { grid-template-columns: 1fr; padding-top: 44px; }
    .hp-hero p { font-size: 16px; }
    .hp-hero-visual img { aspect-ratio: 1.35; }
    .hp-route-strip { grid-template-columns: 1fr; margin-top: 10px; }
  }
  @media (max-width: 640px) {
    .hp-root { padding: 24px 22px 72px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .hp-nav,
    .hp-hero-copy > *,
    .hp-hero-visual,
    .hp-route,
    .hp-cat,
    .hp-article-group {
      animation: none;
      opacity: 1;
      transform: none;
    }
    .hp-hero-visual img,
    .hp-route img,
    .hp-cat { transition: none; }
    .hp-hero-visual:hover img,
    .hp-route:hover img { transform: none; }
  }
`;
