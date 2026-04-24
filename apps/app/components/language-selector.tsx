import { buildLocaleQueryHrefs, SenderoLanguageSelector } from '@sendero/ui/language-selector';

type LanguageSelectorProps = {
  canonicalPath?: string;
  currentLocale: string;
  compact?: boolean;
};

export function LanguageSelector({
  canonicalPath = '/',
  currentLocale,
  compact,
}: LanguageSelectorProps) {
  return (
    <SenderoLanguageSelector
      currentLocale={currentLocale}
      hrefs={buildLocaleQueryHrefs(canonicalPath)}
      className={compact ? 'is-compact' : undefined}
    />
  );
}
