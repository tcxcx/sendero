import { expect, test } from 'bun:test';
import { parseListQuery } from './parse-list-query';

test('parseListQuery clamps pagination and extracts known filters', () => {
  const query = parseListQuery(
    { page: '0', per: '500', status: 'paid', ignored: 'x' },
    { defaultPer: 25, maxPer: 100, knownFilters: ['status'] }
  );

  expect(query.page).toBe(1);
  expect(query.per).toBe(100);
  expect(query.skip).toBe(0);
  expect(query.take).toBe(100);
  expect(query.filters).toEqual({ status: 'paid' });
});
