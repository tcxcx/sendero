/**
 * specialty_coffee_finder — gate + composition + ranking tests.
 *
 * Stubs cseSearch + searchText through deps injection; no live API.
 */

import { describe, expect, test } from 'bun:test';

import {
  type SpecialtyCoffeeFinderDeps,
  runSpecialtyCoffeeFinder,
} from './specialty-coffee-finder';
import type { ToolContext } from '../types';

function makeCtx(overrides?: Partial<ToolContext>): ToolContext {
  return {
    traveler: { tenantId: 'org_test', userId: 'usr_1', name: 'Test' },
    caller: { effectiveKeyType: 'sandbox', keyType: 'sandbox', scopes: ['*'] },
    ...overrides,
  };
}

function makeDeps(overrides?: Partial<SpecialtyCoffeeFinderDeps>): SpecialtyCoffeeFinderDeps {
  return {
    cse: async () => ({ available: true, results: [] }),
    places: async () => ({ available: true, results: [] }),
    ...overrides,
  };
}

describe('specialty_coffee_finder — dev-only gate', () => {
  test('refuses production prod-keys', async () => {
    const ctx = makeCtx({
      caller: { effectiveKeyType: 'production', keyType: 'production', scopes: ['*'] },
    });
    const r = await runSpecialtyCoffeeFinder({ city: 'Tokyo' }, ctx, makeDeps());
    expect(r.status).toBe('production_refused');
  });
});

describe('specialty_coffee_finder — composition', () => {
  test('Places-only fallback ranks by quality when CSE returns nothing', async () => {
    const ctx = makeCtx();
    const deps = makeDeps({
      cse: async () => ({ available: true, results: [] }),
      places: async () => ({
        available: true,
        results: [
          {
            placeId: 'p1',
            name: 'Hidden Bean',
            types: ['coffee_shop'],
            primaryType: 'coffee_shop',
            rating: 4.7,
            userRatingCount: 612,
          },
          {
            placeId: 'p2',
            name: 'Generic Café',
            types: ['cafe'],
            primaryType: 'cafe',
            rating: 4.0,
            userRatingCount: 12,
          },
        ],
      }),
    });

    const r = await runSpecialtyCoffeeFinder({ city: 'Tokyo' }, ctx, deps);
    expect(r.status).toBe('ok');
    if (r.status === 'ok') {
      expect(r.shops.length).toBe(2);
      // Hidden Bean (4.7×log10(613)≈4.7×2.79=13.1/15=0.87) outranks Generic Café.
      expect(r.shops[0]?.name).toBe('Hidden Bean');
      expect(r.shops[0]?.specialtyScore).toBeGreaterThan(r.shops[1]?.specialtyScore ?? 1);
    }
  });

  test('editorial cross-reference boosts cafés mentioned by Sprudge', async () => {
    const ctx = makeCtx();
    const deps = makeDeps({
      cse: async () => ({
        available: true,
        results: [
          {
            title: "Tokyo's Best Specialty Coffee — Mameya Kakeru",
            link: 'https://sprudge.com/post/12345',
            displayLink: 'sprudge.com',
            formattedUrl: 'sprudge.com/post/12345',
            snippet: 'Mameya Kakeru is the standout new wave roaster in Tokyo right now.',
          },
        ],
      }),
      places: async () => ({
        available: true,
        results: [
          {
            placeId: 'p_mameya',
            name: 'Mameya Kakeru',
            types: ['coffee_shop'],
            primaryType: 'coffee_shop',
            rating: 4.6,
            userRatingCount: 350,
          },
          {
            placeId: 'p_gen',
            name: 'Generic Roastery',
            types: ['coffee_shop'],
            primaryType: 'coffee_shop',
            rating: 4.6,
            userRatingCount: 350,
          },
        ],
      }),
    });

    const r = await runSpecialtyCoffeeFinder({ city: 'Tokyo' }, ctx, deps);
    expect(r.status).toBe('ok');
    if (r.status === 'ok') {
      // Same quality, but Mameya Kakeru has Sprudge editorial → should rank #1.
      expect(r.shops[0]?.name).toBe('Mameya Kakeru');
      expect(r.shops[0]?.editorialSources.length).toBeGreaterThan(0);
      expect(r.shops[0]?.editorialSources[0]?.url).toContain('sprudge.com');
      expect(r.shops[0]?.rationale).toContain('sprudge');
    }
  });

  test('drops non-cafe Places hits (restaurants, bakeries without cafe type)', async () => {
    const ctx = makeCtx();
    const deps = makeDeps({
      places: async () => ({
        available: true,
        results: [
          { placeId: 'r', name: 'Bakery & Coffee', types: ['bakery'], primaryType: 'bakery' },
          { placeId: 'c', name: 'Real Café', types: ['cafe'], primaryType: 'cafe' },
        ],
      }),
    });
    const r = await runSpecialtyCoffeeFinder({ city: 'Tokyo' }, ctx, deps);
    if (r.status === 'ok') {
      expect(r.shops.length).toBe(1);
      expect(r.shops[0]?.name).toBe('Real Café');
    }
  });

  test('hard-outage path returns unavailable when both CSE + Places fail', async () => {
    const ctx = makeCtx();
    const deps = makeDeps({
      cse: async () => ({ available: false, reason: 'cse-not-configured', results: [] }),
      places: async () => ({ available: false, reason: 'places-not-configured', results: [] }),
    });
    const r = await runSpecialtyCoffeeFinder({ city: 'Tokyo' }, ctx, deps);
    expect(r.status).toBe('unavailable');
    if (r.status === 'unavailable') {
      expect(r.reason).toContain('cse-not-configured');
      expect(r.reason).toContain('places-not-configured');
    }
  });
});

describe('specialty_coffee_finder — taste-graph integration', () => {
  test('reads taste signals when travelerId + readTasteSignals provided', async () => {
    const ctx = makeCtx();
    let read = false;
    const deps = makeDeps({
      cse: async () => ({ available: true, results: [] }),
      places: async () => ({
        available: true,
        results: [
          {
            placeId: 'p',
            name: 'Some Place',
            types: ['cafe'],
            primaryType: 'cafe',
            rating: 4.5,
            userRatingCount: 100,
          },
        ],
      }),
      readTasteSignals: async _userId => {
        read = true;
        return { prefersWorkingFromCafes: true, likesLocalHiddenGems: false };
      },
    });
    const r = await runSpecialtyCoffeeFinder({ city: 'Tokyo', travelerId: 'usr_1' }, ctx, deps);
    expect(read).toBe(true);
    if (r.status === 'ok') {
      // Rationale should hint at the work-from-cafés taste so the next
      // tool's re-ranking is justifiable.
      expect(r.shops[0]?.rationale.toLowerCase()).toContain('work');
    }
  });

  test('failing taste read does not break ranking (fail-soft)', async () => {
    const ctx = makeCtx();
    const deps = makeDeps({
      places: async () => ({
        available: true,
        results: [
          {
            placeId: 'p',
            name: 'Some Place',
            types: ['cafe'],
            primaryType: 'cafe',
            rating: 4.5,
            userRatingCount: 100,
          },
        ],
      }),
      readTasteSignals: async () => {
        throw new Error('db down');
      },
    });
    const r = await runSpecialtyCoffeeFinder({ city: 'Tokyo', travelerId: 'usr_1' }, ctx, deps);
    expect(r.status).toBe('ok'); // didn't throw
  });
});

describe('specialty_coffee_finder — locale composition', () => {
  test('Spanish locale composes ES query', async () => {
    const ctx = makeCtx();
    let cseQuery = '';
    let placesQuery = '';
    const deps = makeDeps({
      cse: async args => {
        cseQuery = args.query;
        return { available: true, results: [] };
      },
      places: async args => {
        placesQuery = args.query;
        return { available: true, results: [] };
      },
    });
    await runSpecialtyCoffeeFinder({ city: 'Buenos Aires', languageCode: 'es' }, ctx, deps);
    expect(cseQuery).toContain('cafés de especialidad');
    expect(cseQuery).toContain('Buenos Aires');
    expect(placesQuery).toContain('cafés de especialidad');
  });

  test('Portuguese locale composes PT query', async () => {
    const ctx = makeCtx();
    let cseQuery = '';
    const deps = makeDeps({
      cse: async args => {
        cseQuery = args.query;
        return { available: true, results: [] };
      },
    });
    await runSpecialtyCoffeeFinder({ city: 'São Paulo', languageCode: 'pt' }, ctx, deps);
    expect(cseQuery).toContain('cafeterias');
  });
});
