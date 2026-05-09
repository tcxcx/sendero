/**
 * hobby_profile_builder — gate + behavior tests.
 *
 * Prisma calls are stubbed via `deps` injection; tests don't hit a real DB.
 */

import { describe, expect, test } from 'bun:test';

import {
  type HobbyProfileBuilderDeps,
  normalizeHobbyKey,
  runHobbyProfileBuilder,
} from './hobby-profile-builder';
import type { ToolContext } from '../types';

function makeCtx(overrides?: Partial<ToolContext>): ToolContext {
  return {
    traveler: { tenantId: 'org_test', userId: 'usr_1', name: 'Test' },
    caller: { effectiveKeyType: 'sandbox', keyType: 'sandbox', scopes: ['*'] },
    ...overrides,
  };
}

function makeDeps(): {
  deps: HobbyProfileBuilderDeps;
  state: {
    entries: Map<
      string,
      {
        key: string;
        priority: string;
        notes: string | null;
        avoid: string[];
        preferredTimeOfDay: string | null;
        preferredBudget: string | null;
      }
    >;
  };
} {
  const state = {
    entries: new Map<
      string,
      ReturnType<HobbyProfileBuilderDeps['listEntries']> extends Promise<infer T>
        ? T extends Array<infer E>
          ? E
          : never
        : never
    >(),
  };
  const deps: HobbyProfileBuilderDeps = {
    async userExists(_userId) {
      return true;
    },
    async findEntry(_userId, key) {
      const e = state.entries.get(key);
      return e ? { priority: e.priority, notes: e.notes } : null;
    },
    async upsertEntry({ key, priority, notes }) {
      const existing = state.entries.get(key);
      state.entries.set(key, {
        key,
        priority,
        notes: notes ?? existing?.notes ?? null,
        avoid: existing?.avoid ?? [],
        preferredTimeOfDay: existing?.preferredTimeOfDay ?? null,
        preferredBudget: existing?.preferredBudget ?? null,
      });
    },
    async listEntries(_userId) {
      return Array.from(state.entries.values());
    },
  };
  return { deps, state };
}

describe('hobby_profile_builder — dev-only gate', () => {
  test('returns production_refused when caller is a production prod-key', async () => {
    const ctx = makeCtx({
      caller: { effectiveKeyType: 'production', keyType: 'production', scopes: ['*'] },
    });
    const { deps } = makeDeps();
    const result = await runHobbyProfileBuilder(
      { travelerId: 'usr_1', explicitPreferences: ['specialty coffee'] },
      ctx,
      deps
    );
    expect(result.status).toBe('production_refused');
  });

  test('returns production_refused when ctx.traveler.tenantId is missing', async () => {
    const ctx: ToolContext = {
      caller: { effectiveKeyType: 'sandbox', keyType: 'sandbox', scopes: ['*'] },
    };
    const { deps } = makeDeps();
    const result = await runHobbyProfileBuilder({ travelerId: 'usr_1' }, ctx, deps);
    expect(result.status).toBe('production_refused');
  });
});

describe('hobby_profile_builder — happy paths', () => {
  test('explicit preference becomes a high-priority hobby entry', async () => {
    const ctx = makeCtx();
    const { deps, state } = makeDeps();
    const result = await runHobbyProfileBuilder(
      { travelerId: 'usr_1', explicitPreferences: ['I love specialty coffee'] },
      ctx,
      deps
    );
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.newPreferences).toContain('specialty_coffee');
      expect(state.entries.get('specialty_coffee')?.priority).toBe('high');
      expect(result.tasteGraph.cityBehavior.prefersWorkingFromCafes).toBe(true);
    }
  });

  test('escalates priority on stronger signal but never downgrades', async () => {
    const ctx = makeCtx();
    const { deps, state } = makeDeps();
    // First: low-confidence inferred signal
    await runHobbyProfileBuilder(
      {
        travelerId: 'usr_1',
        inferredSignals: [{ source: 'visited', value: 'ramen', confidence: 'low' }],
      },
      ctx,
      deps
    );
    expect(state.entries.get('ramen')?.priority).toBe('low');

    // Then: high-confidence explicit
    await runHobbyProfileBuilder(
      { travelerId: 'usr_1', explicitPreferences: ['ramen'] },
      ctx,
      deps
    );
    expect(state.entries.get('ramen')?.priority).toBe('high');

    // Then: low-confidence again — must NOT downgrade
    const last = await runHobbyProfileBuilder(
      {
        travelerId: 'usr_1',
        inferredSignals: [{ source: 'chat', value: 'ramen', confidence: 'low' }],
      },
      ctx,
      deps
    );
    expect(state.entries.get('ramen')?.priority).toBe('high');
    if (last.status === 'ok') {
      expect(last.newPreferences).toEqual([]);
      expect(last.updatedPreferences).toEqual([]);
    }
  });

  test('cityBehavior derives correctly from hobbies', async () => {
    const ctx = makeCtx();
    const { deps } = makeDeps();
    const result = await runHobbyProfileBuilder(
      {
        travelerId: 'usr_1',
        explicitPreferences: ['cheap michelin', 'founder networking', 'bookstores'],
      },
      ctx,
      deps
    );
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.tasteGraph.cityBehavior.likesBeautyPerDollar).toBe(true);
      expect(result.tasteGraph.cityBehavior.likesNetworkingEvents).toBe(true);
      expect(result.tasteGraph.cityBehavior.likesLocalHiddenGems).toBe(true);
      expect(result.tasteGraph.cityBehavior.prefersWorkingFromCafes).toBe(false);
    }
  });

  test('empty signals returns confidence=low + zero changes', async () => {
    const ctx = makeCtx();
    const { deps } = makeDeps();
    const result = await runHobbyProfileBuilder({ travelerId: 'usr_1' }, ctx, deps);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.confidence).toBe('low');
      expect(result.newPreferences).toEqual([]);
      expect(result.updatedPreferences).toEqual([]);
    }
  });
});

describe('normalizeHobbyKey', () => {
  test('matches canonical hobby keys', () => {
    expect(normalizeHobbyKey('specialty_coffee')).toBe('specialty_coffee');
    expect(normalizeHobbyKey('I love specialty coffee')).toBe('specialty_coffee');
    expect(normalizeHobbyKey('Tercera ola coffee')).toBe('specialty_coffee');
    expect(normalizeHobbyKey('cheap michelin restaurants')).toBe('cheap_michelin');
    expect(normalizeHobbyKey("World's 50 Best")).toBe('worlds_50_best');
    expect(normalizeHobbyKey('AI events')).toBe('ai_events');
    expect(normalizeHobbyKey('I want a date spot')).toBe('date_spots');
    expect(normalizeHobbyKey('founder meetup')).toBe('founder_networking');
  });

  test('slugs custom hobbies', () => {
    expect(normalizeHobbyKey('Salsa dancing')).toBe('salsa_dancing');
    expect(normalizeHobbyKey('Surfing!!!')).toBe('surfing');
  });

  test('multilingual phrasings normalize to the same canonical key', () => {
    // ES (the AI-driven E2E surfaced this gap on 2026-05-06)
    expect(normalizeHobbyKey('lugares para citas con onda')).toBe('date_spots');
    expect(normalizeHobbyKey('cita romántica')).toBe('date_spots');
    expect(normalizeHobbyKey('café de especialidad')).toBe('specialty_coffee');
    expect(normalizeHobbyKey('trabajar desde cafés')).toBe('work_from_cafes');
    expect(normalizeHobbyKey('soy emprendedor')).toBe('founder_networking');
    expect(normalizeHobbyKey('meeting other founders')).toBe('founder_networking');
    expect(normalizeHobbyKey('founding team builders')).toBe('founder_networking');
    expect(normalizeHobbyKey('encuentros con fundadores')).toBe('founder_networking');
    expect(normalizeHobbyKey('encuentro de IA')).toBe('ai_events');
    expect(normalizeHobbyKey('disquería de vinilos')).toBe('record_stores');
    expect(normalizeHobbyKey('galería de arte')).toBe('art_galleries');
    expect(normalizeHobbyKey('vinoteca')).toBe('wine_bars');
    expect(normalizeHobbyKey('correr en la mañana')).toBe('running');
    // PT
    expect(normalizeHobbyKey('livraria independente')).toBe('bookstores');
  });

  test('returns null for too-short input', () => {
    expect(normalizeHobbyKey('a')).toBeNull();
    expect(normalizeHobbyKey('')).toBeNull();
  });
});
