/**
 * Glossary registry + resolver.
 * Add more countries by dropping a file in src/countries and registering here.
 */

import type { TravelGlossary } from './types';
import { enUS } from './countries/en-us';
import { esMX } from './countries/es-mx';
import { ptBR } from './countries/pt-br';
import { esAR } from './countries/es-ar';

export const DEFAULT_LOCALE = 'en-US' as const;
export const LOCALE_COOKIE_NAME = 'SENDERO_LOCALE' as const;
export const LOCALE_QUERY_PARAM = 'sendero_locale' as const;
export const LOCALE_HEADER_NAME = 'x-sendero-locale' as const;

const GLOSSARIES: Record<string, TravelGlossary> = {
  'en-US': enUS,
  'es-MX': esMX,
  'pt-BR': ptBR,
  'es-AR': esAR,
};

export const SUPPORTED_LOCALES = Object.keys(GLOSSARIES) as ReadonlyArray<keyof typeof GLOSSARIES>;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const LOCALE_DISPLAY_NAMES: Record<SupportedLocale, { label: string; native: string }> = {
  'en-US': { label: 'English', native: 'English' },
  'es-AR': { label: 'Spanish (Argentina)', native: 'Español rioplatense' },
  'es-MX': { label: 'Spanish (Mexico)', native: 'Español mexicano' },
  'pt-BR': { label: 'Portuguese (Brazil)', native: 'Português brasileiro' },
};

const LANGUAGE_TO_DEFAULT_LOCALE: Record<string, SupportedLocale> = {
  en: 'en-US',
  es: 'es-MX',
  pt: 'pt-BR',
};

export function isSupportedLocale(locale: string | null | undefined): locale is SupportedLocale {
  if (!locale) return false;
  return (SUPPORTED_LOCALES as readonly string[]).includes(locale);
}

/**
 * Normalize a user/browser supplied locale into one of Sendero's supported
 * BCP-47 tags. Mirrors desk-v1's @bu/location approach: exact match first,
 * then language-only fallback.
 */
export function normalizeLocale(locale: string | null | undefined): SupportedLocale | null {
  if (!locale) return null;
  const cleaned = locale.trim().replace('_', '-');
  const exact = (SUPPORTED_LOCALES as readonly string[]).find(
    l => l.toLowerCase() === cleaned.toLowerCase()
  );
  if (exact) return exact as SupportedLocale;

  const language = cleaned.toLowerCase().split('-')[0];
  return LANGUAGE_TO_DEFAULT_LOCALE[language] ?? null;
}

export function getLocaleDisplayName(locale: string | null | undefined): string {
  const normalized = normalizeLocale(locale) ?? DEFAULT_LOCALE;
  const display = LOCALE_DISPLAY_NAMES[normalized];
  return `${display.native} · ${normalized}`;
}

/**
 * Resolve any BCP-47 tag or country code to a TravelGlossary. Falls back by
 * language, then to en-US. `es-CL` / `es-UY` / `es` all resolve to `es-MX`
 * for now; add specific files as we get signal.
 */
export function getGlossary(localeOrCountry: string | null | undefined): TravelGlossary {
  if (!localeOrCountry) return enUS;

  const input = localeOrCountry.trim();
  const normalized = normalizeLocale(input);
  if (normalized) return GLOSSARIES[normalized];

  const canonical = input.includes('-') ? input : input.toUpperCase();

  // Exact match
  if (canonical in GLOSSARIES) return GLOSSARIES[canonical];

  // Country-only (2-letter) lookup: scan for matching country.
  if (canonical.length === 2) {
    for (const glossary of Object.values(GLOSSARIES)) {
      if (glossary.country === canonical) return glossary;
    }
  }

  // Language-only (2-letter lowercase) fallback
  const language = input.toLowerCase().split('-')[0];
  for (const glossary of Object.values(GLOSSARIES)) {
    if (glossary.locale.toLowerCase().startsWith(`${language}-`)) return glossary;
  }

  return enUS;
}

/** Look up a single term across all glossaries. Useful as an LLM tool. */
export function lookupTerm(
  localeOrCountry: string | null,
  term: string
): { glossary: TravelGlossary; definition: string | null } {
  const glossary = getGlossary(localeOrCountry);
  const lower = term.toLowerCase();
  const definition =
    glossary.travelTerms[term] ??
    glossary.travelTerms[lower] ??
    glossary.moneySlang?.[term] ??
    glossary.commonPhrases?.[term] ??
    null;
  return { glossary, definition };
}

export type { TravelGlossary };
