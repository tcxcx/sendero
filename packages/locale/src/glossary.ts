/**
 * Glossary registry + resolver.
 * Add more countries by dropping a file in src/countries and registering here.
 */

import type { TravelGlossary } from './types';
import { enUS } from './countries/en-us';
import { esMX } from './countries/es-mx';
import { ptBR } from './countries/pt-br';
import { esAR } from './countries/es-ar';

const GLOSSARIES: Record<string, TravelGlossary> = {
  'en-US': enUS,
  'es-MX': esMX,
  'pt-BR': ptBR,
  'es-AR': esAR,
};

export const SUPPORTED_LOCALES = Object.keys(GLOSSARIES) as ReadonlyArray<keyof typeof GLOSSARIES>;

/**
 * Resolve any BCP-47 tag or country code to a TravelGlossary. Falls back by
 * language, then to en-US. `es-CL` / `es-UY` / `es` all resolve to `es-MX`
 * for now; add specific files as we get signal.
 */
export function getGlossary(localeOrCountry: string | null | undefined): TravelGlossary {
  if (!localeOrCountry) return enUS;

  const input = localeOrCountry.trim();
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
