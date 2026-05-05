/**
 * Supported Translation Locales
 *
 * These are the 17 languages the app is translated into.
 * This is SEPARATE from country blocking (security) - a user from
 * any allowed country can have any of these language preferences.
 *
 * IMPORTANT: This file has NO server-side imports (no next/headers, etc.)
 * so it can be used by both server and client components.
 *
 * Security (country blocking) is handled by:
 * - excludedCountries
 * - isCountryExcluded()
 *
 * Translation (UI language) is handled by:
 * - SUPPORTED_LOCALES
 * - getSupportedLocale()
 */

export const SUPPORTED_LOCALES = [
  'en', // English (default)
  'es', // Spanish
  'pt', // Portuguese
  'ja', // Japanese
  'zh', // Chinese
  'fr', // French
  'ko', // Korean
  'it', // Italian
  'hi', // Hindi
  'vi', // Vietnamese
  'de', // German
  'tr', // Turkish
  'bn', // Bengali
  'yo', // Yoruba
  'id', // Indonesian
  'ur', // Urdu
  'nl', // Dutch
] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: SupportedLocale = 'en';

/**
 * Check if a locale code is supported for translations
 */
export function isLocaleSupported(locale: string): locale is SupportedLocale {
  return SUPPORTED_LOCALES.includes(locale.toLowerCase() as SupportedLocale);
}

/**
 * Resolve a raw locale (e.g., 'en-US', 'es-MX') to a supported locale.
 * Extracts the base language code and matches against supported locales.
 * Falls back to 'en' if no match.
 *
 * @param rawLocale - The raw locale string from IP detection (e.g., 'en-US', 'es-419')
 * @returns A supported locale code
 */
export function getSupportedLocale(rawLocale: string | null | undefined): SupportedLocale {
  if (!rawLocale) return DEFAULT_LOCALE;

  // Extract base language code (e.g., 'en-US' -> 'en', 'es-419' -> 'es')
  const base = rawLocale.split('-')[0]?.toLowerCase();
  if (!base) return DEFAULT_LOCALE;

  return isLocaleSupported(base) ? base : DEFAULT_LOCALE;
}
