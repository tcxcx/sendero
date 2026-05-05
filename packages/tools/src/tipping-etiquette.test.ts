/**
 * tipping_etiquette unit tests.
 *
 * Asserts the curated catalogue covers every scenario for every listed
 * country (no silent gaps), and that the tool round-trips a few
 * canonical rows we've manually verified.
 */

import { describe, expect, test } from 'bun:test';

import {
  _listSupportedCountries,
  TIPPING_SCENARIOS,
  TippingCountryUnknownError,
  tippingEtiquette,
  tippingEtiquetteTool,
} from './tipping-etiquette';

describe('tipping_etiquette', () => {
  test('returns canonical Japan / restaurant guidance (no-tip culture)', async () => {
    const out = await tippingEtiquette({ countryIso2: 'JP', scenario: 'restaurant' });
    expect(out.countryIso2).toBe('JP');
    expect(out.countryName).toBe('Japan');
    expect(out.recommendedPct).toBe(0);
    expect(out.notes).toMatch(/not customary/i);
    expect(out.localCurrency).toBe('JPY');
  });

  test('returns canonical US / restaurant guidance (high-tip culture)', async () => {
    const out = await tippingEtiquette({ countryIso2: 'US', scenario: 'restaurant' });
    expect(out.recommendedPct).toBe(18);
    expect(out.range).toEqual([15, 22]);
    expect(out.localCurrency).toBe('USD');
  });

  test('returns flat amount with unit for hotel scenarios', async () => {
    const out = await tippingEtiquette({ countryIso2: 'US', scenario: 'hotel_porter' });
    expect(out.recommendedFlat).toEqual({ amount: 2, currency: 'USD' });
    expect(out.flatUnit).toBe('per_bag');
  });

  test('lowercase country code is accepted (transformed to upper by schema)', async () => {
    const parsed = tippingEtiquetteTool.inputSchema.parse({
      countryIso2: 'fr',
      scenario: 'restaurant',
    });
    const out = await tippingEtiquette(parsed);
    expect(out.countryIso2).toBe('FR');
  });

  test('unknown country throws TippingCountryUnknownError', async () => {
    await expect(
      tippingEtiquette({ countryIso2: 'ZZ', scenario: 'restaurant' })
    ).rejects.toBeInstanceOf(TippingCountryUnknownError);
  });

  test('zod schema rejects bad country code shape', () => {
    const r = tippingEtiquetteTool.inputSchema.safeParse({
      countryIso2: 'USA',
      scenario: 'restaurant',
    });
    expect(r.success).toBe(false);
  });

  test('zod schema rejects unknown scenario', () => {
    const r = tippingEtiquetteTool.inputSchema.safeParse({
      countryIso2: 'US',
      scenario: 'haircut',
    });
    expect(r.success).toBe(false);
  });

  test('catalogue covers every scenario for every listed country (no silent gaps)', async () => {
    const countries = _listSupportedCountries();
    expect(countries.length).toBeGreaterThanOrEqual(25);
    for (const c of countries) {
      for (const s of TIPPING_SCENARIOS) {
        const out = await tippingEtiquette({ countryIso2: c, scenario: s });
        expect(out.countryIso2).toBe(c);
        expect(out.scenario).toBe(s);
        // Each row must have at least one of pct / flat / notes — never an empty result.
        const hasGuidance =
          typeof out.recommendedPct === 'number' ||
          out.recommendedFlat !== undefined ||
          (out.notes !== undefined && out.notes.length > 0);
        expect(hasGuidance).toBe(true);
      }
    }
  });

  test('LatAm corridor is well-covered (Sendero core market)', () => {
    const supported = _listSupportedCountries();
    for (const iso of ['AR', 'BR', 'CL', 'CO', 'PE', 'UY', 'MX']) {
      expect(supported).toContain(iso);
    }
  });
});
