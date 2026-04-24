import { isSupportedLocale, SUPPORTED_LOCALES } from '@sendero/locale';
import { notFound } from 'next/navigation';
import { HelpHomeForLocale } from '../page';

export const revalidate = 300;

export function generateStaticParams() {
  return SUPPORTED_LOCALES.map(locale => ({ locale }));
}

export default async function LocaleHelpHome({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) notFound();
  return <HelpHomeForLocale locale={locale} />;
}
