/**
 * work_from_cafe_ranker — gate + scoring + composition tests.
 *
 * Stubbed deps everywhere; no live API or DB.
 */

import { describe, expect, test } from 'bun:test';

import {
  type WorkFromCafeRankerDeps,
  runWorkFromCafeRanker,
} from './work-from-cafe-ranker';
import type { ToolContext } from '../types';

function makeCtx(overrides?: Partial<ToolContext>): ToolContext {
  return {
    traveler: { tenantId: 'org_test', userId: 'usr_1', name: 'Test' },
    caller: { effectiveKeyType: 'sandbox', keyType: 'sandbox', scopes: ['*'] },
    ...overrides,
  };
}

describe('work_from_cafe_ranker — dev-only gate', () => {
  test('refuses production prod-keys', async () => {
    const ctx = makeCtx({
      caller: { effectiveKeyType: 'production', keyType: 'production', scopes: ['*'] },
    });
    const r = await runWorkFromCafeRanker(
      {
        candidates: [
          {
            placeId: 'p1',
            name: 'Anywhere',
            specialtyScore: 0.5,
            editorialSources: [],
          },
        ],
      },
      ctx
    );
    expect(r.status).toBe('production_refused');
  });
});

describe('work_from_cafe_ranker — pass-through scoring', () => {
  test('wifi + outlet + laptop mentions all boost score', async () => {
    const ctx = makeCtx();
    const r = await runWorkFromCafeRanker(
      {
        candidates: [
          {
            placeId: 'p1',
            name: 'Bare Cafe',
            specialtyScore: 0.7,
            editorialSources: [
              { title: 'Generic listicle', url: 'http://x', snippet: 'A nice cafe.' },
            ],
          },
          {
            placeId: 'p2',
            name: 'Loaded Cafe',
            specialtyScore: 0.5, // lower specialty …
            editorialSources: [
              {
                title: 'Best laptop spots',
                url: 'http://y',
                snippet: 'Fast wifi, plenty of outlets, quiet spacious seating for remote work.',
              },
            ],
          },
        ],
      },
      ctx
    );
    expect(r.status).toBe('ok');
    if (r.status === 'ok') {
      // Loaded should win on combined despite lower specialty — wifi +
      // outlets + laptop + quiet boost workFriendlyScore enough.
      expect(r.shops[0]?.name).toBe('Loaded Cafe');
      expect(r.shops[0]?.workFriendlyScore).toBeGreaterThan(
        r.shops[1]?.workFriendlyScore ?? 1
      );
      const sigs = r.shops[0]?.workSignals ?? [];
      expect(sigs.some(s => s.includes('wifi'))).toBe(true);
      expect(sigs.some(s => s.includes('outlets'))).toBe(true);
      expect(sigs.some(s => s.includes('laptop'))).toBe(true);
    }
  });

  test('Spanish enchufes mention triggers outlet signal', async () => {
    const ctx = makeCtx();
    const r = await runWorkFromCafeRanker(
      {
        candidates: [
          {
            placeId: 'p1',
            name: 'Cafe Argentino',
            specialtyScore: 0.5,
            editorialSources: [
              {
                title: 'Cafés para trabajar en BA',
                url: 'http://x',
                snippet: 'Buen wifi y muchos enchufes para tu laptop.',
              },
            ],
          },
        ],
      },
      ctx
    );
    if (r.status === 'ok') {
      const sigs = r.shops[0]?.workSignals ?? [];
      expect(sigs.some(s => s.includes('outlets'))).toBe(true);
      expect(sigs.some(s => s.includes('laptop'))).toBe(true);
    }
  });

  test('very-expensive penalty applies', async () => {
    const ctx = makeCtx();
    const r = await runWorkFromCafeRanker(
      {
        candidates: [
          {
            placeId: 'p1',
            name: 'Premium Cafe',
            specialtyScore: 0.7,
            priceLevel: 'PRICE_LEVEL_VERY_EXPENSIVE',
            editorialSources: [
              { title: 'Tasting menu', url: 'http://x', snippet: 'No wifi mentioned.' },
            ],
          },
          {
            placeId: 'p2',
            name: 'Moderate Cafe',
            specialtyScore: 0.7,
            priceLevel: 'PRICE_LEVEL_MODERATE',
            editorialSources: [
              { title: 'Solid spot', url: 'http://y', snippet: 'No wifi mentioned.' },
            ],
          },
        ],
      },
      ctx
    );
    if (r.status === 'ok') {
      // Same specialty + same (no) signals; very-expensive should rank below moderate.
      expect(r.shops[0]?.name).toBe('Moderate Cafe');
    }
  });

  test('hyper-popular penalty: 4.7+ rating with 1000+ reviews', async () => {
    const ctx = makeCtx();
    const r = await runWorkFromCafeRanker(
      {
        candidates: [
          {
            placeId: 'p1',
            name: 'Tourist Spot',
            rating: 4.8,
            userRatingCount: 5000,
            specialtyScore: 0.7,
            editorialSources: [],
          },
          {
            placeId: 'p2',
            name: 'Local Gem',
            rating: 4.6,
            userRatingCount: 200,
            specialtyScore: 0.7,
            editorialSources: [],
          },
        ],
      },
      ctx
    );
    if (r.status === 'ok') {
      expect(r.shops[0]?.name).toBe('Local Gem');
      const sigs = r.shops[0]?.workSignals ?? [];
      // Local Gem should NOT have the crowded penalty fire.
      expect(sigs.some(s => s.includes('crowded'))).toBe(false);
    }
  });

  test('soft floor — every cafe gets at least 0.1 even with no signals', async () => {
    const ctx = makeCtx();
    const r = await runWorkFromCafeRanker(
      {
        candidates: [
          {
            placeId: 'p1',
            name: 'Empty Cafe',
            specialtyScore: 0.5,
            editorialSources: [],
          },
        ],
      },
      ctx
    );
    if (r.status === 'ok') {
      expect(r.shops[0]?.workFriendlyScore).toBeGreaterThanOrEqual(0.1);
    }
  });
});

describe('work_from_cafe_ranker — fresh discovery', () => {
  test('runs specialty_coffee_finder under the hood when only city given', async () => {
    const ctx = makeCtx();
    let placesCalled = false;
    const deps: WorkFromCafeRankerDeps = {
      specialty: {
        cse: async () => ({ available: true, results: [] }),
        places: async args => {
          placesCalled = true;
          expect(args.query.toLowerCase()).toContain('coffee');
          return {
            available: true,
            results: [
              {
                placeId: 'p1',
                name: 'Real Cafe',
                types: ['coffee_shop'],
                primaryType: 'coffee_shop',
                rating: 4.5,
                userRatingCount: 200,
              },
            ],
          };
        },
      },
    };
    const r = await runWorkFromCafeRanker({ city: 'Tokyo' }, ctx, deps);
    expect(placesCalled).toBe(true);
    expect(r.status).toBe('ok');
    if (r.status === 'ok') {
      expect(r.mode).toBe('fresh-discovery');
      expect(r.city).toBe('Tokyo');
    }
  });

  test('upstream unavailability propagates as unavailable', async () => {
    const ctx = makeCtx();
    const deps: WorkFromCafeRankerDeps = {
      specialty: {
        cse: async () => ({ available: false, reason: 'cse-not-configured', results: [] }),
        places: async () => ({
          available: false,
          reason: 'places-not-configured',
          results: [],
        }),
      },
    };
    const r = await runWorkFromCafeRanker({ city: 'Tokyo' }, ctx, deps);
    expect(r.status).toBe('unavailable');
  });
});
