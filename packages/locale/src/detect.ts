/**
 * Locale detection utilities used at request boundaries.
 *
 * Strategy (matches desk-v1's proxy pattern):
 *   1. Explicit cookie: `SENDERO_LOCALE`
 *   2. Authenticated user's stored preference (caller-provided)
 *   3. Accept-Language header → best-match against SUPPORTED_LOCALES
 *   4. Country-to-locale heuristic (CF-IPCountry / Vercel geo header)
 *   5. Fallback: `en-US`
 */

import { SUPPORTED_LOCALES } from './glossary';

const FALLBACK = 'en-US' as const;

export function bestMatchFromAcceptLanguage(header: string | null | undefined): string | null {
  if (!header) return null;
  const candidates = header
    .split(',')
    .map(part => {
      const [tag, ...rest] = part.trim().split(';');
      const q = rest.map(s => s.trim()).find(s => s.startsWith('q='));
      return { tag: tag.trim(), q: q ? Number(q.slice(2)) : 1.0 };
    })
    .filter(c => c.tag)
    .sort((a, b) => b.q - a.q);

  for (const { tag } of candidates) {
    const match = (SUPPORTED_LOCALES as readonly string[]).find(
      l => l.toLowerCase() === tag.toLowerCase()
    );
    if (match) return match;
  }
  // Language-only fallback
  for (const { tag } of candidates) {
    const lang = tag.toLowerCase().split('-')[0];
    const match = (SUPPORTED_LOCALES as readonly string[]).find(l =>
      l.toLowerCase().startsWith(`${lang}-`)
    );
    if (match) return match;
  }
  return null;
}

const COUNTRY_TO_LOCALE: Record<string, string> = {
  US: 'en-US',
  GB: 'en-US',
  CA: 'en-US',
  AU: 'en-US',
  MX: 'es-MX',
  ES: 'es-MX',
  CL: 'es-MX',
  CO: 'es-MX',
  PE: 'es-MX',
  AR: 'es-AR',
  UY: 'es-AR',
  PY: 'es-AR',
  BR: 'pt-BR',
  PT: 'pt-BR',
};

export function localeForCountry(country: string | null | undefined): string | null {
  if (!country) return null;
  return COUNTRY_TO_LOCALE[country.toUpperCase()] ?? null;
}

export interface LocaleDetectInput {
  cookie?: string | null;
  userPreference?: string | null;
  acceptLanguage?: string | null;
  country?: string | null;
}

export function detectLocale(input: LocaleDetectInput): string {
  return (
    input.cookie ||
    input.userPreference ||
    bestMatchFromAcceptLanguage(input.acceptLanguage) ||
    localeForCountry(input.country) ||
    FALLBACK
  );
}
