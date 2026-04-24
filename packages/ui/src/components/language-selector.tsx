import {
  DEFAULT_LOCALE,
  getLocaleDisplayName,
  LOCALE_DISPLAY_NAMES,
  LOCALE_QUERY_PARAM,
  normalizeLocale,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from '@sendero/locale';

type LocaleHrefMap = Partial<Record<SupportedLocale, string>>;

export interface SenderoLanguageSelectorProps {
  currentLocale: string;
  hrefs?: LocaleHrefMap;
  includeStyles?: boolean;
  label?: string;
  className?: string;
}

const SHORT_LOCALE_LABELS: Record<SupportedLocale, string> = {
  'en-US': 'EN',
  'es-MX': 'MX',
  'pt-BR': 'BR',
  'es-AR': 'AR',
};

const DEFAULT_LABELS: Record<SupportedLocale, string> = {
  'en-US': 'Language',
  'es-MX': 'Idioma',
  'pt-BR': 'Idioma',
  'es-AR': 'Idioma',
};

export function SenderoLanguageSelector({
  className,
  currentLocale,
  hrefs,
  includeStyles = true,
  label,
}: SenderoLanguageSelectorProps) {
  const normalizedCurrent = normalizeLocale(currentLocale) ?? DEFAULT_LOCALE;
  const labelText = label ?? DEFAULT_LABELS[normalizedCurrent];

  return (
    <nav
      className={['sendero-language-selector', className].filter(Boolean).join(' ')}
      aria-label={labelText}
    >
      {includeStyles ? <style>{senderoLanguageSelectorCss}</style> : null}
      <span>{labelText}</span>
      <div className="sendero-language-selector-options">
        {SUPPORTED_LOCALES.map(locale => {
          const normalized = normalizeLocale(locale) ?? DEFAULT_LOCALE;
          const isActive = normalized === normalizedCurrent;
          const display = LOCALE_DISPLAY_NAMES[normalized];
          return (
            <a
              aria-current={isActive ? 'true' : undefined}
              className={isActive ? 'is-active' : undefined}
              href={hrefs?.[normalized] ?? localeQueryHref(normalized, '/')}
              hrefLang={normalized}
              key={normalized}
              title={display?.native ?? getLocaleDisplayName(normalized)}
            >
              {SHORT_LOCALE_LABELS[normalized]}
            </a>
          );
        })}
      </div>
    </nav>
  );
}

export function buildLocaleApiHrefs(
  canonicalPath: string,
  options: { apiPath?: string; includeLocalizedPath?: boolean } = {}
): LocaleHrefMap {
  return Object.fromEntries(
    SUPPORTED_LOCALES.map(locale => [locale, localeApiHref(locale, canonicalPath, options)])
  ) as LocaleHrefMap;
}

export function buildLocaleQueryHrefs(
  canonicalPath: string,
  options: { queryParam?: string } = {}
): LocaleHrefMap {
  return Object.fromEntries(
    SUPPORTED_LOCALES.map(locale => [
      locale,
      localeQueryHref(locale, canonicalPath, options.queryParam),
    ])
  ) as LocaleHrefMap;
}

export function localeApiHref(
  locale: string,
  canonicalPath: string,
  options: { apiPath?: string; includeLocalizedPath?: boolean } = {}
): string {
  const normalized = normalizeLocale(locale) ?? DEFAULT_LOCALE;
  const path = normalizeCanonicalPath(canonicalPath);
  const next =
    options.includeLocalizedPath === false ? path : localizedLocalePath(normalized, path);
  const params = new URLSearchParams({ locale: normalized, next });
  return `${options.apiPath ?? '/api/locale'}?${params.toString()}`;
}

export function localeQueryHref(
  locale: string,
  canonicalPath: string,
  queryParam: string = LOCALE_QUERY_PARAM
): string {
  const normalized = normalizeLocale(locale) ?? DEFAULT_LOCALE;
  const path = normalizeCanonicalPath(canonicalPath);
  const [pathname, hash = ''] = path.split('#');
  const separator = pathname.includes('?') ? '&' : '?';
  return `${pathname}${separator}${queryParam}=${encodeURIComponent(normalized)}${
    hash ? `#${hash}` : ''
  }`;
}

export function localizedLocalePath(locale: string, canonicalPath: string): string {
  const normalized = normalizeLocale(locale) ?? DEFAULT_LOCALE;
  const path = normalizeCanonicalPath(canonicalPath);
  if (normalized === DEFAULT_LOCALE) return path;
  return `/${normalized}${path === '/' ? '' : path}`;
}

function normalizeCanonicalPath(canonicalPath: string): string {
  if (!canonicalPath) return '/';
  return canonicalPath.startsWith('/') ? canonicalPath : `/${canonicalPath}`;
}

export const senderoLanguageSelectorCss = `
  .sendero-language-selector {
    --sendero-language-ink: var(--ink, #fb542b);
    --sendero-language-bg: var(--bg, var(--background, #eedcc7));
    --sendero-language-muted: var(--muted, var(--text-dim, #6b6b6b));
    --sendero-language-ease: var(--motion-ease-out, var(--mk-ease-out, var(--hp-ease-out, var(--docs-ease-out, cubic-bezier(0.23, 1, 0.32, 1)))));
    display: grid;
    gap: 7px;
    justify-items: end;
    font-family: var(--mono, var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace));
    font-size: 11px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .sendero-language-selector > span {
    color: var(--sendero-language-muted);
    font-size: 10px;
    letter-spacing: 0.13em;
  }

  .sendero-language-selector-options {
    display: inline-grid;
    grid-template-columns: repeat(4, minmax(34px, 1fr));
    border: 1px solid var(--sendero-language-ink);
    background: var(--sendero-language-bg);
  }

  .sendero-language-selector-options a {
    display: grid;
    min-width: 34px;
    min-height: 30px;
    place-items: center;
    border-left: 1px solid var(--sendero-language-ink);
    color: var(--sendero-language-ink);
    text-decoration: none;
    transition:
      background 180ms var(--sendero-language-ease),
      color 180ms var(--sendero-language-ease),
      transform 140ms var(--sendero-language-ease);
  }

  .sendero-language-selector-options a:first-child {
    border-left: 0;
  }

  .sendero-language-selector-options a:hover,
  .sendero-language-selector-options a.is-active,
  .sendero-language-selector-options a[aria-current="true"] {
    background: var(--sendero-language-ink);
    color: #fafaf7;
    text-decoration: none;
  }

  .sendero-language-selector-options a:active {
    transform: scale(0.96);
  }

  @media (max-width: 640px) {
    .sendero-language-selector {
      justify-items: stretch;
    }

    .sendero-language-selector-options {
      grid-template-columns: repeat(4, minmax(0, 1fr));
      width: 100%;
    }

    .sendero-language-selector-options a {
      min-height: 38px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .sendero-language-selector-options a {
      transition: none;
    }
  }
`;
