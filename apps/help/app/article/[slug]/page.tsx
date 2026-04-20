import { detectLocale } from '@sendero/locale';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getHelpArticleBySlug } from '@/lib/articles';

interface ArticlePageProps {
  params: Promise<{ slug: string }>;
}

export const revalidate = 300;

export default async function ArticlePage({ params }: ArticlePageProps) {
  const { slug } = await params;
  const hdrs = await headers();
  const locale = detectLocale({
    acceptLanguage: hdrs.get('accept-language'),
    country: hdrs.get('x-vercel-ip-country'),
  });
  const article = await getHelpArticleBySlug(slug, locale);
  if (!article) notFound();

  return (
    <main className="hp-article-root">
      <nav className="hp-breadcrumb">
        <a href="/">Help</a> / <a href={`/${article.category}`}>{article.category}</a>
      </nav>
      <article>
        <h1>{article.title}</h1>
        <p className="hp-article-excerpt">{article.excerpt}</p>
        <div className="hp-article-meta">
          Updated {article.updatedAt} · {article.locale}
        </div>
        <div className="hp-article-body">
          {article.body.split('\n\n').map((p, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static markdown blocks
            <p key={i}>{p}</p>
          ))}
        </div>
      </article>

      <style>{`
        .hp-article-root { max-width: 720px; margin: 0 auto; padding: 48px 24px 80px; font-family: var(--sans); color: var(--fg); }
        .hp-breadcrumb { font-family: var(--mono); font-size: 11px; letter-spacing: 0.1em; color: var(--muted); text-transform: uppercase; margin-bottom: 32px; }
        article h1 { font-size: clamp(28px, 4vw, 40px); letter-spacing: -0.025em; margin: 0 0 16px; font-weight: 500; }
        .hp-article-excerpt { font-size: 18px; color: var(--muted); margin: 0 0 16px; }
        .hp-article-meta { font-family: var(--mono); font-size: 11px; letter-spacing: 0.1em; color: var(--muted); text-transform: uppercase; margin-bottom: 32px; }
        .hp-article-body p { margin: 0 0 16px; }
      `}</style>
    </main>
  );
}
