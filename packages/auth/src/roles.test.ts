import { test, expect } from 'bun:test';
import { mapClerkRoleToPrisma, ROLES } from './roles';

test('ROLES constants', () => {
  expect(ROLES.ADMIN).toBe('org:admin');
  expect(ROLES.FINANCE).toBe('org:finance');
  expect(ROLES.MEMBER).toBe('org:member');
});

test('mapClerkRoleToPrisma — canonical roles', () => {
  expect(mapClerkRoleToPrisma('org:admin')).toBe('agency_admin');
  expect(mapClerkRoleToPrisma('org:finance')).toBe('finance');
  expect(mapClerkRoleToPrisma('org:member')).toBe('traveler');
});

test('mapClerkRoleToPrisma — default to traveler on unknown', () => {
  expect(mapClerkRoleToPrisma('org:random')).toBe('traveler');
  expect(mapClerkRoleToPrisma('')).toBe('traveler');
});

test('mapClerkRoleToPrisma — tolerates Clerk legacy aliases', () => {
  // Clerk had older role strings before org:* prefix became canonical.
  expect(mapClerkRoleToPrisma('admin')).toBe('agency_admin');
  expect(mapClerkRoleToPrisma('basic_member')).toBe('traveler');
});
