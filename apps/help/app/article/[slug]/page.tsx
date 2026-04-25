import { notFound } from 'next/navigation';

import { DEFAULT_LOCALE, normalizeLocale } from '@sendero/locale';

import { getHelpContent } from '@/lib/articles';
import { linkifyParagraph } from '@/lib/linkify-paragraph';
import { getRequestLocale } from '@/lib/request-locale';

import { categoryTitle, formattedDate, LocaleSelector, localizedPath } from '../../page';

interface ArticlePageProps {
  params: Promise<{ slug: string }>;
}

export const revalidate = 300;

export default async function ArticlePage({ params }: ArticlePageProps) {
  const { slug } = await params;
  const locale = await getRequestLocale();
  return <HelpArticleForLocale locale={locale} slug={slug} />;
}

export async function HelpArticleForLocale({ locale, slug }: { locale: string; slug: string }) {
  const content = await getHelpContent(locale);
  const normalized = normalizeLocale(content.locale) ?? DEFAULT_LOCALE;
  const article = content.articles.find(candidate => candidate.slug === slug);
  if (!article) notFound();

  return (
    <main className="hp-article-root">
      <header className="hp-article-header">
        <a className="hp-brand" href={localizedPath(normalized, '/')}>
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
        <LocaleSelector
          canonicalPath={`/article/${slug}`}
          currentLocale={normalized}
          label={content.nav.language}
        />
      </header>

      <nav className="hp-breadcrumb">
        <a href={localizedPath(normalized, '/')}>{content.article.home}</a>
        <span>/</span>
        <a href={`${localizedPath(normalized, '/')}#${article.category}`}>
          {categoryTitle(content, article)}
        </a>
      </nav>
      <article>
        <h1>{article.title}</h1>
        <p className="hp-article-excerpt">{article.excerpt}</p>
        <div className="hp-article-meta">
          {content.article.updated} {formattedDate(article.updatedAt, normalized)} · {normalized}
        </div>
        <div className="hp-article-body">
          {article.body.split('\n\n').map((paragraph, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static localized article paragraphs
            <p key={index}>{linkifyParagraph(paragraph)}</p>
          ))}
        </div>
      </article>

      <style>{articleCss}</style>
    </main>
  );
}

const articleCss = `
  .hp-article-root { --hp-ease-out: cubic-bezier(0.23, 1, 0.32, 1); max-width: 760px; margin: 0 auto; padding: 32px 24px 80px; font-family: var(--sans); color: var(--fg); }
  .hp-article-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; padding: 8px 0 44px; margin-bottom: 36px; border-bottom: 1px solid var(--border); font-family: var(--mono-x); font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; animation: hpArticleIn 420ms var(--hp-ease-out) both; }
  .hp-brand { display: inline-flex; align-items: center; gap: 8px; color: var(--fg); text-decoration: none; }
  .hp-mark { display: inline-block; width: 28px; height: 28px; object-fit: contain; flex-shrink: 0; }
  .hp-x { opacity: 0.4; }
  .hp-breadcrumb { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-family: var(--mono-x); font-size: 11px; letter-spacing: 0.1em; color: var(--muted); text-transform: uppercase; margin-bottom: 32px; }
  article h1 { font-family: var(--display); font-size: clamp(30px, 4vw, 44px); letter-spacing: -0.018em; margin: 0 0 16px; font-weight: 450; text-wrap: balance; }
  .hp-article-excerpt { font-size: 18px; line-height: 1.5; color: var(--muted); margin: 0 0 16px; }
  .hp-article-meta { font-family: var(--mono-x); font-size: 11px; letter-spacing: 0.1em; color: var(--muted); text-transform: uppercase; margin-bottom: 32px; }
  .hp-article-body { font-size: 16px; line-height: 1.72; }
  .hp-article-body p { margin: 0 0 18px; }
  .hp-article-link { color: var(--ink); text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 2px; }
  .hp-article-link:hover { text-decoration-thickness: 2px; }
  .hp-article-link:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; border-radius: 4px; }
  @media (prefers-reduced-motion: no-preference) {
    .hp-breadcrumb,
    article h1,
    .hp-article-excerpt,
    .hp-article-meta,
    .hp-article-body p {
      animation: hpArticleIn 380ms var(--hp-ease-out) both;
    }
    article h1 { animation-delay: 45ms; }
    .hp-article-excerpt { animation-delay: 80ms; }
    .hp-article-meta { animation-delay: 110ms; }
    .hp-article-body p:nth-child(1) { animation-delay: 130ms; }
    .hp-article-body p:nth-child(2) { animation-delay: 150ms; }
    .hp-article-body p:nth-child(n + 3) { animation-delay: 170ms; }
  }
  @keyframes hpArticleIn { from { opacity: 0; transform: translateY(7px); } to { opacity: 1; transform: translateY(0); } }
  @media (max-width: 640px) {
    .hp-article-root { padding: 24px 22px 72px; }
    .hp-article-header { flex-direction: column; align-items: stretch; gap: 18px; padding-bottom: 34px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .hp-article-header,
    .hp-breadcrumb,
    article h1,
    .hp-article-excerpt,
    .hp-article-meta,
    .hp-article-body p {
      animation: none;
      opacity: 1;
      transform: none;
    }
  }
`;
