/**
 * ISO 3166-1 alpha-2 ↔ alpha-3 conversion.
 *
 * Single source of truth: `countries-intl.json` (250 countries with
 * `alpha2` + `alpha3` + `default_locale` + `currency`).
 *
 * Replaces the partial hand-maintained `ISO3_TO_ISO2` table that lived
 * inside `packages/tools/src/book-flight.ts`. That table missed common
 * codes (ECU, VEN, etc.) and silently dropped passport vault lookups
 * for any nationality outside the ~40-country shortlist.
 */
import countries from './countries-intl.json';

interface CountryRecord {
  alpha2: string;
  alpha3: string;
  name: string;
  default_locale: string;
  currency: string;
  languages?: Record<string, string>;
  region?: string;
  continent?: string;
  emoji?: string;
}

const ALL = countries as unknown as CountryRecord[];

const ISO3_TO_ISO2: Record<string, string> = {};
const ISO2_TO_ISO3: Record<string, string> = {};
const BY_ISO2: Record<string, CountryRecord> = {};
const BY_ISO3: Record<string, CountryRecord> = {};

for (const c of ALL) {
  if (!c.alpha2 || !c.alpha3) continue;
  const a2 = c.alpha2.toUpperCase();
  const a3 = c.alpha3.toUpperCase();
  ISO3_TO_ISO2[a3] = a2;
  ISO2_TO_ISO3[a2] = a3;
  BY_ISO2[a2] = c;
  BY_ISO3[a3] = c;
}

/**
 * Convert an ISO-3166-1 alpha-3 code (e.g. `ECU`) to alpha-2 (`EC`).
 * Returns null when the input doesn't match any known country —
 * caller decides whether to fail closed or fall through.
 */
export function iso3to2(iso3: string | null | undefined): string | null {
  if (!iso3) return null;
  return ISO3_TO_ISO2[iso3.toUpperCase()] ?? null;
}

/**
 * Convert an ISO-3166-1 alpha-2 code (e.g. `EC`) to alpha-3 (`ECU`).
 * Returns null on no match.
 */
export function iso2to3(iso2: string | null | undefined): string | null {
  if (!iso2) return null;
  return ISO2_TO_ISO3[iso2.toUpperCase()] ?? null;
}

/**
 * Lookup the full country record by either alpha-2 or alpha-3 code.
 * Returns null when not found. Use this when you need name + currency
 * + default_locale + emoji together (avoids 4 separate calls).
 */
export function lookupCountry(code: string | null | undefined): CountryRecord | null {
  if (!code) return null;
  const upper = code.toUpperCase();
  return BY_ISO2[upper] ?? BY_ISO3[upper] ?? null;
}

/** All countries in the table — useful for dropdowns + validation. */
export function allCountries(): readonly CountryRecord[] {
  return ALL;
}

export type { CountryRecord };
