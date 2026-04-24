import { buildLocaleQueryHrefs, SenderoLanguageSelector } from '@sendero/ui/language-selector';

type LanguageSelectorProps = {
  canonicalPath?: string;
  currentLocale: string;
};

export function LanguageSelector({ canonicalPath = '/', currentLocale }: LanguageSelectorProps) {
  return (
    <SenderoLanguageSelector
      currentLocale={currentLocale}
      hrefs={buildLocaleQueryHrefs(canonicalPath)}
    />
  );
}
