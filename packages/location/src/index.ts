import { headers } from 'next/headers';

import countries from './countries.json';
import flags from './country-flags';
import { currencies, stablecoins, uniqueCurrencies } from './currencies';
import { EU_COUNTRY_CODES } from './eu-countries';
import timezones from './timezones.json';

type CountryData = {
  currencies: Partial<Record<string, { name: string; symbol: string }>>;
  languages: Partial<Record<string, string>>;
  cca2: string;
};

export async function getCountryCode() {
  return (await headers()).get('x-vercel-ip-country') || 'AR';
}

export async function getCityFromIP() {
  return (await headers()).get('x-vercel-ip-city') || 'Buenos Aires';
}

export async function getTimezone() {
  return (await headers()).get('x-vercel-ip-timezone') || 'Europe/Berlin';
}

export async function getLocale() {
  return (await headers()).get('x-vercel-ip-locale') || 'en-US';
}

export async function getLatitude() {
  return (await headers()).get('x-vercel-ip-latitude') || null;
}

export async function getLongitude() {
  return (await headers()).get('x-vercel-ip-longitude') || null;
}

export function getTimezones() {
  return timezones;
}

export async function getCurrency() {
  const countryCode = await getCountryCode();
  return currencies[countryCode as keyof typeof currencies];
}

export async function getDateFormat() {
  const country = getCountryCode();

  // US uses MM/dd/yyyy
  if ((await country) === 'US') {
    return 'MM/dd/yyyy';
  }

  // China, Japan, Korea, Taiwan use yyyy-MM-dd
  if (['CN', 'JP', 'KR', 'TW'].includes(await country)) {
    return 'yyyy-MM-dd';
  }
  // Most Latin American, African, and some Asian countries use dd/MM/yyyy
  if (['AU', 'NZ', 'IN', 'ZA', 'BR', 'AR'].includes(await country)) {
    return 'dd/MM/yyyy';
  }

  // Default to yyyy-MM-dd for other countries
  return 'yyyy-MM-dd';
}

export async function getCountryInfo() {
  const country = await getCountryCode();
  const countryInfo = countries.find(x => x.cca2 === country) as CountryData;
  const currencyCode = countryInfo && Object.keys(countryInfo.currencies)[0];
  const currency = currencyCode && countryInfo.currencies[currencyCode];
  const languages = countryInfo?.languages && Object.values(countryInfo.languages).join(', ');

  return { currencyCode, currency, languages };
}

export async function isEU() {
  const countryCode = getCountryCode();

  if (countryCode && EU_COUNTRY_CODES.includes(await countryCode)) {
    return true;
  }

  return false;
}

export async function getCountry() {
  const country = await getCountryCode();
  return flags[country as keyof typeof flags];
}

export { uniqueCurrencies, stablecoins, currencies };

// Security: Country blocking for compliance
export { excludedCountries, isCountryExcluded } from './excluded';
// Greetings & timezone utilities (pure functions — no server deps)
export {
  format24hTime,
  type GreetingContext,
  type GreetingResult,
  getCreativeGreeting,
  getHourInTimezone,
} from './greetings';
// Translation: Supported UI locales
export {
  DEFAULT_LOCALE,
  getSupportedLocale,
  isLocaleSupported,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from './supported-locales';

/**
 * Determines if the week starts on Monday based on country code.
 * ISO 8601 standard: Monday is first day.
 * Sunday-start countries: US, CA, JP, IL, SA, and others.
 */
export function getWeekStartsOnMonday(countryCode: string): boolean {
  const sundayStartCountries = [
    'US',
    'CA',
    'JP',
    'IL',
    'SA',
    'AE',
    'BH',
    'QA',
    'KW',
    'OM',
    'PH',
    'TH',
    'GT',
    'HN',
    'SV',
    'NI',
    'PA',
    'DO',
    'BZ',
    'PR',
    'AS',
    'GU',
    'VI',
    'MH',
    'FM',
  ];
  return !sundayStartCountries.includes(countryCode);
}

export interface UserGeoData {
  countryCode: string;
  city: string;
  timezone: string;
  locale: string;
  weekStartsOnMonday: boolean;
  latitude: string | null;
  longitude: string | null;
}

/** Gather all geo-data from request headers in a single call */
export async function getFullLocationData(): Promise<UserGeoData> {
  const countryCode = await getCountryCode();
  const city = await getCityFromIP();
  const timezone = await getTimezone();
  const locale = await getLocale();
  const weekStartsOnMonday = getWeekStartsOnMonday(countryCode);
  const latitude = await getLatitude();
  const longitude = await getLongitude();
  return { countryCode, city, timezone, locale, weekStartsOnMonday, latitude, longitude };
}
