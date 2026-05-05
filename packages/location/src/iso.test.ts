import { describe, expect, test } from 'bun:test';
import { iso2to3, iso3to2, lookupCountry } from './iso';

describe('iso3to2', () => {
  test('LatAm + Caribbean', () => {
    expect(iso3to2('ECU')).toBe('EC');
    expect(iso3to2('VEN')).toBe('VE');
    expect(iso3to2('PRY')).toBe('PY');
    expect(iso3to2('BOL')).toBe('BO');
    expect(iso3to2('CRI')).toBe('CR');
    expect(iso3to2('PAN')).toBe('PA');
    expect(iso3to2('GTM')).toBe('GT');
    expect(iso3to2('DOM')).toBe('DO');
    expect(iso3to2('CUB')).toBe('CU');
    expect(iso3to2('ARG')).toBe('AR');
    expect(iso3to2('BRA')).toBe('BR');
    expect(iso3to2('CHL')).toBe('CL');
    expect(iso3to2('PER')).toBe('PE');
    expect(iso3to2('MEX')).toBe('MX');
    expect(iso3to2('USA')).toBe('US');
  });
  test('Europe + Asia + Africa', () => {
    expect(iso3to2('FRA')).toBe('FR');
    expect(iso3to2('DEU')).toBe('DE');
    expect(iso3to2('JPN')).toBe('JP');
    expect(iso3to2('CHN')).toBe('CN');
    expect(iso3to2('IND')).toBe('IN');
    expect(iso3to2('AUS')).toBe('AU');
    expect(iso3to2('ZAF')).toBe('ZA');
    expect(iso3to2('EGY')).toBe('EG');
    expect(iso3to2('NGA')).toBe('NG');
  });
  test('case-insensitive', () => {
    expect(iso3to2('ecu')).toBe('EC');
    expect(iso3to2('Ecu')).toBe('EC');
  });
  test('null + invalid', () => {
    expect(iso3to2(null)).toBeNull();
    expect(iso3to2('')).toBeNull();
    expect(iso3to2('XXX')).toBeNull();
    expect(iso3to2('EC')).toBeNull(); // alpha-2, not alpha-3
  });
});

describe('iso2to3', () => {
  test('round-trip parity', () => {
    expect(iso2to3('EC')).toBe('ECU');
    expect(iso2to3('AR')).toBe('ARG');
    expect(iso2to3('US')).toBe('USA');
    expect(iso2to3('FR')).toBe('FRA');
    expect(iso2to3('JP')).toBe('JPN');
    expect(iso2to3(null)).toBeNull();
    expect(iso2to3('XX')).toBeNull();
  });
});

describe('lookupCountry', () => {
  test('returns full record by either code', () => {
    const ecuByA2 = lookupCountry('EC');
    const ecuByA3 = lookupCountry('ECU');
    expect(ecuByA2?.alpha3).toBe('ECU');
    expect(ecuByA3?.alpha2).toBe('EC');
    expect(ecuByA2?.name).toBe('Ecuador');
    expect(ecuByA2?.default_locale).toBe('es-EC');
    expect(ecuByA2?.currency).toBe('USD');
  });
  test('null on miss', () => {
    expect(lookupCountry('XX')).toBeNull();
    expect(lookupCountry('XXX')).toBeNull();
    expect(lookupCountry(null)).toBeNull();
  });
});
