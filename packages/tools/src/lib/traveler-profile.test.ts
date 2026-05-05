import { test, expect } from 'bun:test';

import { mergeVisitedCity } from './traveler-profile';

test('mergeVisitedCity returns empty array when input is null/undefined and no city given', () => {
  expect(mergeVisitedCity(null, '', '')).toEqual([]);
  expect(mergeVisitedCity(undefined, 'PE', null)).toEqual([]);
});

test('mergeVisitedCity appends a new entry when city is unseen', () => {
  const at = new Date('2026-05-05T12:00:00Z');
  const out = mergeVisitedCity(null, 'PE', 'Lima', at);
  expect(out).toEqual([{ iso2: 'PE', citySlug: 'lima', lastVisitedAt: at.toISOString() }]);
});

test('mergeVisitedCity dedupes by (iso2, citySlug) — refreshes lastVisitedAt', () => {
  const first = new Date('2026-04-01T00:00:00Z');
  const second = new Date('2026-05-01T00:00:00Z');
  const initial = mergeVisitedCity(null, 'PE', 'Lima', first);
  const updated = mergeVisitedCity(initial as unknown as null, 'PE', 'Lima', second);
  expect(updated).toHaveLength(1);
  expect(updated[0]?.lastVisitedAt).toBe(second.toISOString());
});

test('mergeVisitedCity slugifies diacritics — "São Paulo" === "Sao Paulo"', () => {
  const at = new Date('2026-05-05T12:00:00Z');
  const a = mergeVisitedCity(null, 'BR', 'São Paulo', at);
  const b = mergeVisitedCity(a as unknown as null, 'BR', 'Sao Paulo', at);
  expect(b).toHaveLength(1);
  expect(b[0]?.citySlug).toBe('sao-paulo');
});

test('mergeVisitedCity puts the most-recent city at the head', () => {
  const t1 = new Date('2026-04-01T00:00:00Z');
  const t2 = new Date('2026-05-01T00:00:00Z');
  const t3 = new Date('2026-06-01T00:00:00Z');
  let list = mergeVisitedCity(null, 'PE', 'Lima', t1);
  list = mergeVisitedCity(list as unknown as null, 'AR', 'Buenos Aires', t2);
  list = mergeVisitedCity(list as unknown as null, 'PE', 'Lima', t3);
  expect(list.map(c => c.citySlug)).toEqual(['lima', 'buenos-aires']);
  expect(list[0]?.lastVisitedAt).toBe(t3.toISOString());
});

test('mergeVisitedCity tolerates malformed JSON entries (filters them out)', () => {
  const at = new Date('2026-05-05T12:00:00Z');
  const malformed = [
    'string-not-object',
    { iso2: 'PE' }, // missing citySlug
    { iso2: 'AR', citySlug: 'eze' }, // missing lastVisitedAt
    { iso2: 'BR', citySlug: 'rio', lastVisitedAt: '2026-01-01T00:00:00Z' }, // good
  ];
  const out = mergeVisitedCity(malformed as unknown as null, 'PE', 'Lima', at);
  expect(out).toHaveLength(2);
  expect(out[0]?.citySlug).toBe('lima');
  expect(out[1]?.citySlug).toBe('rio');
});

test('mergeVisitedCity drops entries with empty iso2 or city', () => {
  const at = new Date('2026-05-05T12:00:00Z');
  expect(mergeVisitedCity(null, '', 'Lima', at)).toEqual([]);
  expect(mergeVisitedCity(null, 'PE', '', at)).toEqual([]);
});
