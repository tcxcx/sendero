/**
 * List of excluded/prohibited countries (ISO 3166-1 alpha-2 codes)
 * Based on compliance requirements and regulatory obligations
 * Reference: https://desk.bu.finance/faq/prohibited-countries
 *
 * This list includes sanctioned countries and regions where
 * BUFI services cannot be offered due to:
 * - OFAC sanctions
 * - Regional compliance requirements
 * - Regulatory restrictions
 */
export const excludedCountries = [
  'AF', // Afghanistan
  'BY', // Belarus
  'BG', // Bulgaria
  'KP', // North Korea
  'CN', // China
  'HR', // Croatia
  'CU', // Cuba
  'ET', // Ethiopia
  'IN', // India
  'IQ', // Iraq
  'IR', // Iran
  'IL', // Israel
  'LB', // Lebanon
  'LY', // Libya
  'ML', // Mali
  'MM', // Myanmar
  'NP', // Nepal
  'NI', // Nicaragua
  'NG', // Nigeria
  'CF', // Central African Republic
  'CD', // Democratic Republic of Congo
  'RU', // Russia
  'SY', // Syria
  'SO', // Somalia
  'SD', // Sudan
  'SS', // South Sudan
  'TR', // Turkey
  'UA', // Ukraine
  'VE', // Venezuela
  'YE', // Yemen
  'ZW', // Zimbabwe
] as const;

export type ExcludedCountryCode = (typeof excludedCountries)[number];

/**
 * Check if a country code is in the excluded list
 */
export function isCountryExcluded(countryCode: string): boolean {
  return excludedCountries.includes(countryCode.toUpperCase() as ExcludedCountryCode);
}
