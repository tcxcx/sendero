/**
 * city_bucket_list_manager — gate + action mapping tests.
 */

import { describe, expect, test } from 'bun:test';
import { BucketListItemStatus } from '@sendero/database';

import {
  type CityBucketListManagerDeps,
  runCityBucketListManager,
} from './city-bucket-list-manager';
import type { ToolContext } from '../types';

function makeCtx(overrides?: Partial<ToolContext>): ToolContext {
  return {
    traveler: { tenantId: 'org_test', userId: 'usr_1', name: 'Test' },
    caller: { effectiveKeyType: 'sandbox', keyType: 'sandbox', scopes: ['*'] },
    ...overrides,
  };
}

function makeDeps(): {
  deps: CityBucketListManagerDeps;
  rows: Map<string, { id: string; status: BucketListItemStatus }>;
} {
  const rows = new Map<string, { id: string; status: BucketListItemStatus }>();
  let counter = 1;
  const deps: CityBucketListManagerDeps = {
    async findItem({ userId, city, name, placeId }) {
      const key = `${userId}|${city}|${placeId ?? name}`;
      return rows.get(key) ?? null;
    },
    async upsertItem({ userId, city, name, placeId, status }) {
      const id = `bli_${counter++}`;
      const key = `${userId}|${city}|${placeId ?? name}`;
      const row = { id, status };
      rows.set(key, row);
      return row;
    },
    async updateItemStatus({ id, status }) {
      for (const [k, v] of rows.entries()) {
        if (v.id === id) {
          const updated = { id, status };
          rows.set(k, updated);
          return updated;
        }
      }
      throw new Error('not found');
    },
  };
  return { deps, rows };
}

describe('city_bucket_list_manager — dev-only gate', () => {
  test('refuses production prod-keys', async () => {
    const ctx = makeCtx({
      caller: { effectiveKeyType: 'production', keyType: 'production', scopes: ['*'] },
    });
    const { deps } = makeDeps();
    const result = await runCityBucketListManager(
      {
        travelerId: 'usr_1',
        city: 'Tokyo',
        item: { name: 'Mameya Kakeru', category: 'specialty_coffee' },
        action: 'save',
      },
      ctx,
      deps
    );
    expect(result.status).toBe('production_refused');
  });
});

describe('city_bucket_list_manager — action mapping', () => {
  test('save creates a want_to_visit row', async () => {
    const ctx = makeCtx();
    const { deps, rows } = makeDeps();
    const result = await runCityBucketListManager(
      {
        travelerId: 'usr_1',
        city: 'Tokyo',
        item: { name: 'Koffee Mameya Kakeru', category: 'specialty_coffee' },
        action: 'save',
      },
      ctx,
      deps
    );
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.itemStatus).toBe(BucketListItemStatus.want_to_visit);
    }
    expect(rows.size).toBe(1);
  });

  test('loved upgrades a saved row', async () => {
    const ctx = makeCtx();
    const { deps } = makeDeps();
    await runCityBucketListManager(
      {
        travelerId: 'usr_1',
        city: 'Lima',
        item: { name: 'Maido', category: 'cheap_michelin' },
        action: 'save',
      },
      ctx,
      deps
    );
    const result = await runCityBucketListManager(
      {
        travelerId: 'usr_1',
        city: 'Lima',
        item: { name: 'Maido', category: 'cheap_michelin' },
        action: 'loved',
      },
      ctx,
      deps
    );
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.itemStatus).toBe(BucketListItemStatus.loved);
    }
  });

  test('skip flips status to skip', async () => {
    const ctx = makeCtx();
    const { deps } = makeDeps();
    const result = await runCityBucketListManager(
      {
        travelerId: 'usr_1',
        city: 'Mexico City',
        item: { name: 'Tourist trap café', category: 'specialty_coffee' },
        action: 'skip',
      },
      ctx,
      deps
    );
    if (result.status === 'ok') {
      expect(result.itemStatus).toBe(BucketListItemStatus.skip);
    }
  });

  test('recommend_to_friend maps to want_to_visit but message reflects strong signal', async () => {
    const ctx = makeCtx();
    const { deps } = makeDeps();
    const result = await runCityBucketListManager(
      {
        travelerId: 'usr_1',
        city: 'Buenos Aires',
        item: { name: 'Don Julio', category: 'cheap_michelin' },
        action: 'recommend_to_friend',
      },
      ctx,
      deps
    );
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.itemStatus).toBe(BucketListItemStatus.want_to_visit);
      expect(result.message).toContain('recommend');
    }
  });

  test('placeId match takes precedence over name match', async () => {
    const ctx = makeCtx();
    const { deps } = makeDeps();
    await runCityBucketListManager(
      {
        travelerId: 'usr_1',
        city: 'Tokyo',
        item: { name: 'Mameya', category: 'cafe', placeId: 'place_kakeru' },
        action: 'save',
      },
      ctx,
      deps
    );
    // Same placeId, different name — should match the existing row, not create a duplicate.
    const second = await runCityBucketListManager(
      {
        travelerId: 'usr_1',
        city: 'Tokyo',
        item: { name: 'Mameya Kakeru (typo)', category: 'cafe', placeId: 'place_kakeru' },
        action: 'loved',
      },
      ctx,
      deps
    );
    if (second.status === 'ok') {
      expect(second.itemStatus).toBe(BucketListItemStatus.loved);
    }
  });
});
