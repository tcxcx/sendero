import flags from './country-flags';
import { currencies } from './currencies';

/**
 * Get the flag emoji for a given currency code
 * @param currencyCode - The 3-letter currency code (e.g., 'USD', 'EUR', 'ARS')
 * @returns The flag emoji representing the currency
 */
export function getCurrencyFlag(currencyCode: string): string {
  const code = currencyCode.toUpperCase();

  // Handle stablecoins by mapping them to their base currencies
  const stablecoinMap: Record<string, string> = {
    USDC: 'USD',
    EURC: 'EUR',
  };

  const mappedCode = stablecoinMap[code] || code;

  // Primary country mappings for currencies used by multiple countries
  const primaryCountryMap: Record<string, string> = {
    USD: 'US',
    EUR: 'EU', // European Union flag for Euro
    GBP: 'GB',
    JPY: 'JP',
    CNY: 'CN',
    KRW: 'KR',
    INR: 'IN',
    RUB: 'RU',
    CHF: 'CH',
    AUD: 'AU',
    CAD: 'CA',
    HKD: 'HK',
    NZD: 'NZ',
    SGD: 'SG',
    SEK: 'SE',
    NOK: 'NO',
    DKK: 'DK',
    AED: 'AE',
    SAR: 'SA',
    ILS: 'IL',
    IDR: 'ID',
    MYR: 'MY',
    PHP: 'PH',
    THB: 'TH',
    VND: 'VN',
    ARS: 'AR',
    BRL: 'BR',
    CLP: 'CL',
    COP: 'CO',
    MXN: 'MX',
    PEN: 'PE',
    UYU: 'UY',
    VEF: 'VE',
    ZAR: 'ZA',
    NGN: 'NG',
    KES: 'KE',
    EGP: 'EG',
    PLN: 'PL',
    CZK: 'CZ',
    HUF: 'HU',
    RON: 'RO',
    BGN: 'BG',
    HRK: 'HR',
    TRY: 'TR',
    PKR: 'PK',
    BDT: 'BD',
  };

  // First check if we have a direct mapping
  if (primaryCountryMap[mappedCode]) {
    const countryCode = primaryCountryMap[mappedCode];
    const flagData = flags[countryCode as keyof typeof flags];
    return flagData?.emoji || '🌍';
  }

  // If no direct mapping, search for the first country that uses this currency
  const countryEntry = Object.entries(currencies).find(([_, curr]) => curr === mappedCode);
  if (countryEntry) {
    const [countryCode] = countryEntry;
    const flagData = flags[countryCode as keyof typeof flags];
    return flagData?.emoji || '🌍';
  }

  // Default fallback
  return '🌍';
}
