import { describe, expect, test } from 'bun:test';

import { iataToCountryAlpha2, IATA_COUNTRY_TABLE_SIZE } from '@sendero/duffel/country-from-iata';

import {
  deriveCountriesFromIntent,
  deriveCountriesFromSegment,
  deriveCountriesFromStay,
  deriveRouteCountries,
} from './derive-route-countries';

describe('iataToCountryAlpha2', () => {
  test('resolves major hubs', () => {
    expect(iataToCountryAlpha2('SFO')).toBe('US');
    expect(iataToCountryAlpha2('LHR')).toBe('GB');
    expect(iataToCountryAlpha2('NRT')).toBe('JP');
    expect(iataToCountryAlpha2('DXB')).toBe('AE');
    expect(iataToCountryAlpha2('GRU')).toBe('BR');
  });

  test('case-insensitive', () => {
    expect(iataToCountryAlpha2('sfo')).toBe('US');
    expect(iataToCountryAlpha2(' Lhr ')).toBe('GB');
  });

  test('rejects non-IATA-shaped input', () => {
    expect(iataToCountryAlpha2('USA')).toBe(null); // ISO-3 not IATA
    expect(iataToCountryAlpha2('San Francisco')).toBe(null);
    expect(iataToCountryAlpha2('')).toBe(null);
    expect(iataToCountryAlpha2(null)).toBe(null);
    expect(iataToCountryAlpha2(undefined)).toBe(null);
  });

  test('returns null for unknown 3-letter codes', () => {
    expect(iataToCountryAlpha2('ZZZ')).toBe(null);
    expect(iataToCountryAlpha2('XXX')).toBe(null);
  });

  test('curated table has at least 200 entries', () => {
    expect(IATA_COUNTRY_TABLE_SIZE).toBeGreaterThan(200);
  });
});

describe('deriveCountriesFromSegment', () => {
  test('reads explicit originCountry/destinationCountry', () => {
    const seg = { originCountry: 'us', destinationCountry: 'jp' };
    const result = deriveCountriesFromSegment(seg);
    expect(result.originCountry).toBe('US');
    expect(result.destinationCountry).toBe('JP');
    expect(result.originSource).toBe('segment-explicit');
    expect(result.destinationSource).toBe('segment-explicit');
  });

  test('falls back to IATA lookup when country missing', () => {
    const seg = { originIata: 'SFO', destinationIata: 'NRT' };
    const result = deriveCountriesFromSegment(seg);
    expect(result.originCountry).toBe('US');
    expect(result.destinationCountry).toBe('JP');
    expect(result.originSource).toBe('segment-iata-fallback');
    expect(result.destinationSource).toBe('segment-iata-fallback');
  });

  test('mixes explicit + fallback per side', () => {
    const seg = { originCountry: 'BR', destinationIata: 'CDG' };
    const result = deriveCountriesFromSegment(seg);
    expect(result.originCountry).toBe('BR');
    expect(result.originSource).toBe('segment-explicit');
    expect(result.destinationCountry).toBe('FR');
    expect(result.destinationSource).toBe('segment-iata-fallback');
  });

  test('returns nulls when nothing resolvable', () => {
    const result = deriveCountriesFromSegment({ flightNumber: 'LH404' });
    expect(result.originCountry).toBe(null);
    expect(result.destinationCountry).toBe(null);
    expect(result.originSource).toBe('none');
    expect(result.destinationSource).toBe('none');
  });

  test('handles snake_case field aliases', () => {
    const seg = { origin_country_code: 'US', destination_country_code: 'GB' };
    const result = deriveCountriesFromSegment(seg);
    expect(result.originCountry).toBe('US');
    expect(result.destinationCountry).toBe('GB');
  });
});

describe('deriveCountriesFromIntent', () => {
  test('IATA in origin/destination free-form fields', () => {
    const intent = { origin: 'SFO', destination: 'NRT' };
    const result = deriveCountriesFromIntent(intent);
    expect(result.originCountry).toBe('US');
    expect(result.destinationCountry).toBe('JP');
    expect(result.originSource).toBe('intent-iata-fallback');
  });

  test('does not guess from city names', () => {
    const intent = { origin: 'San Francisco', destination: 'Tokyo' };
    const result = deriveCountriesFromIntent(intent);
    expect(result.originCountry).toBe(null);
    expect(result.destinationCountry).toBe(null);
  });

  test('explicit iso2 wins over IATA', () => {
    const intent = { origin: 'JFK', originIso2: 'CA', destination: 'LHR' };
    const result = deriveCountriesFromIntent(intent);
    expect(result.originCountry).toBe('CA');
    expect(result.originSource).toBe('intent-explicit');
    expect(result.destinationCountry).toBe('GB');
    expect(result.destinationSource).toBe('intent-iata-fallback');
  });
});

describe('deriveCountriesFromStay', () => {
  test('reads country / countryCode / country_code aliases', () => {
    expect(deriveCountriesFromStay({ country: 'fr' }).destinationCountry).toBe('FR');
    expect(deriveCountriesFromStay({ countryCode: 'IT' }).destinationCountry).toBe('IT');
    expect(deriveCountriesFromStay({ country_code: 'es' }).destinationCountry).toBe('ES');
  });

  test('origin always null for stays', () => {
    const result = deriveCountriesFromStay({ country: 'FR' });
    expect(result.originCountry).toBe(null);
    expect(result.originSource).toBe('none');
  });
});

describe('deriveRouteCountries (composite)', () => {
  test('first segment with resolvable origin wins', () => {
    const segments = [
      { originIata: 'SFO', destinationIata: 'JFK' },
      { originIata: 'JFK', destinationIata: 'LHR' },
    ];
    const result = deriveRouteCountries({ segments });
    expect(result.originCountry).toBe('US');
    // Round-tripped country (US→US) should not stick; first dest that
    // differs wins → LHR/GB
    expect(result.destinationCountry).toBe('GB');
  });

  test('falls through to intent when segments are empty', () => {
    const intent = { origin: 'CDG', destination: 'BCN' };
    const result = deriveRouteCountries({ segments: [], intent });
    expect(result.originCountry).toBe('FR');
    expect(result.destinationCountry).toBe('ES');
  });

  test('falls through to stay when only destination available', () => {
    const result = deriveRouteCountries({
      segments: [],
      intent: {},
      stay: { country: 'JP' },
    });
    expect(result.originCountry).toBe(null);
    expect(result.destinationCountry).toBe('JP');
    expect(result.destinationSource).toBe('stay-explicit');
  });

  test('round-trip with single domestic segment falls back to last segment', () => {
    const segments = [{ originIata: 'SFO', destinationIata: 'LAX' }];
    const result = deriveRouteCountries({ segments });
    expect(result.originCountry).toBe('US');
    expect(result.destinationCountry).toBe('US');
  });
});
