import { isSupportedLocale, SUPPORTED_LOCALES } from '@sendero/locale';
import { notFound } from 'next/navigation';
import { getFallbackHelpArticleSlugs } from '@/lib/articles';
import { HelpArticleForLocale } from '../../../article/[slug]/page';

export const revalidate = 300;

export function generateStaticParams() {
  const slugs = getFallbackHelpArticleSlugs();
  return SUPPORTED_LOCALES.flatMap(locale => slugs.map(slug => ({ locale, slug })));
}

export default async function LocaleArticlePage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  if (!isSupportedLocale(locale)) notFound();
  return <HelpArticleForLocale locale={locale} slug={slug} />;
}
