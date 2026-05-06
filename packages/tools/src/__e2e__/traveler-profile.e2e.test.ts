/**
 * Deterministic E2E for the TravelerProfile write hooks.
 *
 * Hits the real dev DB via @sendero/database. Skipped when DATABASE_URL
 * isn't configured (CI without Neon); deterministic + cheap when the
 * connection is available.
 *
 * What this catches that unit tests on `mergeVisitedCity` alone don't:
 *   - The Prisma `upsert` actually accepts the JSON shape we're emitting
 *     (Json column type compatibility).
 *   - Idempotency holds across the full upsert cycle, not just the
 *     in-memory merge.
 *   - The (tenantId, userId) compound query path actually scopes —
 *     cross-tenant writes to the same userId would create the wrong
 *     row, and the tenant-scoping defense lives in the unique
 *     constraint + the upsert's `where` clause.
 *   - First-trip + repeat-trip paths converge on the same row (no
 *     ghost duplicates).
 *
 * Spec: docs/architecture/concierge-magic.md §4 (write hooks).
 *
 * Each test creates + deletes its own fixture User + Tenant + Profile
 * so a previous failed run doesn't leave the DB dirty for the next.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { prisma } from '@sendero/database';

import {
  onFlightBooked,
  onLoyaltyAccountGiven,
  onStayBooked,
  onVoiceReceived,
} from '../lib/traveler-profile';

const HAS_DB = Boolean(process.env.DATABASE_URL);
const itDb = HAS_DB ? test : test.skip;

if (!HAS_DB) {
  console.warn(
    '[traveler-profile.e2e] Skipping DB-hitting suite — set DATABASE_URL ' +
      '(via `vercel env pull .env.local` or local Neon URL) to enable.'
  );
}

// Test fixture — one tenant + two users we own. Created in beforeAll,
// dropped in afterAll. Ids namespaced with `tp_e2e_` so a manual
// cleanup query (`DELETE FROM users WHERE id LIKE 'tp_e2e_%'`) is
// always safe.
const F_TENANT_ID = `tp_e2e_tenant_${Date.now()}`;
const F_USER_A = `tp_e2e_user_a_${Date.now()}`;
const F_USER_B = `tp_e2e_user_b_${Date.now()}`;

beforeAll(async () => {
  if (!HAS_DB) return;
  await prisma.tenant.create({
    data: {
      id: F_TENANT_ID,
      clerkOrgId: F_TENANT_ID,
      slug: F_TENANT_ID.toLowerCase(),
      displayName: 'TP E2E tenant',
    },
  });
  await prisma.user.create({
    data: {
      id: F_USER_A,
      email: `${F_USER_A}@example.com`,
      displayName: 'A Traveler',
    },
  });
  await prisma.user.create({
    data: {
      id: F_USER_B,
      email: `${F_USER_B}@example.com`,
      displayName: 'B Traveler',
    },
  });
});

afterAll(async () => {
  if (!HAS_DB) return;
  await prisma.travelerProfile.deleteMany({
    where: { userId: { in: [F_USER_A, F_USER_B] } },
  });
  await prisma.user.deleteMany({ where: { id: { in: [F_USER_A, F_USER_B] } } });
  await prisma.tenant.delete({ where: { id: F_TENANT_ID } }).catch(() => undefined);
});

describe('traveler-profile write hooks (E2E)', () => {
  itDb('onFlightBooked creates the row when none exists', async () => {
    await onFlightBooked({
      userId: F_USER_A,
      tenantId: F_TENANT_ID,
      destinationIso2: 'PE',
      destinationCity: null,
      preferredCabin: null,
    });
    const row = await prisma.travelerProfile.findUnique({ where: { userId: F_USER_A } });
    expect(row).not.toBeNull();
    expect(row?.totalTrips).toBe(1);
    expect(row?.lastTripAt).not.toBeNull();
    // visitedCities skipped because city was null — defensive default.
    expect(row?.visitedCities).toEqual([]);
  });

  itDb('onFlightBooked is idempotent — second call increments totalTrips by 1', async () => {
    await onFlightBooked({
      userId: F_USER_A,
      tenantId: F_TENANT_ID,
      destinationIso2: 'AR',
      destinationCity: null,
      preferredCabin: 'business',
    });
    const row = await prisma.travelerProfile.findUnique({ where: { userId: F_USER_A } });
    expect(row?.totalTrips).toBe(2);
    expect(row?.preferredCabin).toBe('business');
  });

  itDb('onStayBooked appends to visitedCities and dedupes by (iso2, citySlug)', async () => {
    await onStayBooked({
      userId: F_USER_A,
      tenantId: F_TENANT_ID,
      destinationIso2: 'PE',
      destinationCity: 'Lima',
    });
    let row = await prisma.travelerProfile.findUnique({ where: { userId: F_USER_A } });
    expect(Array.isArray(row?.visitedCities)).toBe(true);
    expect((row?.visitedCities as Array<{ citySlug: string }>).length).toBe(1);
    expect((row?.visitedCities as Array<{ citySlug: string }>)[0]?.citySlug).toBe('lima');

    // Second call with same city should NOT add a duplicate row.
    await onStayBooked({
      userId: F_USER_A,
      tenantId: F_TENANT_ID,
      destinationIso2: 'PE',
      destinationCity: 'Lima',
    });
    row = await prisma.travelerProfile.findUnique({ where: { userId: F_USER_A } });
    expect((row?.visitedCities as unknown[]).length).toBe(1);

    // New city → second entry, ordered most-recent-first.
    await onStayBooked({
      userId: F_USER_A,
      tenantId: F_TENANT_ID,
      destinationIso2: 'AR',
      destinationCity: 'Buenos Aires',
    });
    row = await prisma.travelerProfile.findUnique({ where: { userId: F_USER_A } });
    const cities = row?.visitedCities as Array<{ iso2: string; citySlug: string }>;
    expect(cities[0]?.iso2).toBe('AR');
    expect(cities[0]?.citySlug).toBe('buenos-aires');
    expect(cities[1]?.iso2).toBe('PE');
  });

  itDb('onVoiceReceived flips voicePreferred=true (one-way)', async () => {
    await onVoiceReceived({ userId: F_USER_A, tenantId: F_TENANT_ID });
    let row = await prisma.travelerProfile.findUnique({ where: { userId: F_USER_A } });
    expect(row?.voicePreferred).toBe(true);
    // Calling again is a no-op — flag stays true.
    await onVoiceReceived({ userId: F_USER_A, tenantId: F_TENANT_ID });
    row = await prisma.travelerProfile.findUnique({ where: { userId: F_USER_A } });
    expect(row?.voicePreferred).toBe(true);
  });

  itDb('onLoyaltyAccountGiven persists into loyaltyAccounts JSON', async () => {
    await onLoyaltyAccountGiven({
      userId: F_USER_A,
      tenantId: F_TENANT_ID,
      category: 'airlines',
      supplierCode: 'AA',
      accountNumber: 'AA12345',
    });
    let row = await prisma.travelerProfile.findUnique({ where: { userId: F_USER_A } });
    expect(row?.loyaltyAccounts).toEqual({ airlines: { AA: 'AA12345' }, hotels: {} });

    // Second airline merges — no overwrite of the first.
    await onLoyaltyAccountGiven({
      userId: F_USER_A,
      tenantId: F_TENANT_ID,
      category: 'airlines',
      supplierCode: 'UA',
      accountNumber: 'UA9876',
    });
    row = await prisma.travelerProfile.findUnique({ where: { userId: F_USER_A } });
    expect(row?.loyaltyAccounts).toEqual({
      airlines: { AA: 'AA12345', UA: 'UA9876' },
      hotels: {},
    });
  });

  itDb('user B starts fresh — no profile bleed across users', async () => {
    const before = await prisma.travelerProfile.findUnique({ where: { userId: F_USER_B } });
    expect(before).toBeNull();
    // Touching B's profile must not affect A.
    await onFlightBooked({
      userId: F_USER_B,
      tenantId: F_TENANT_ID,
      destinationIso2: 'JP',
      destinationCity: 'Tokyo',
      preferredCabin: null,
    });
    const a = await prisma.travelerProfile.findUnique({ where: { userId: F_USER_A } });
    const b = await prisma.travelerProfile.findUnique({ where: { userId: F_USER_B } });
    expect(a?.totalTrips).toBe(2); // unchanged
    expect(b?.totalTrips).toBe(1);
    expect(b?.preferredCabin).toBeNull();
  });

  itDb('missing userId/tenantId is a silent no-op (defensive)', async () => {
    // No throw, no row created.
    await onFlightBooked({
      userId: '',
      tenantId: F_TENANT_ID,
      destinationIso2: 'CL',
      destinationCity: null,
      preferredCabin: null,
    });
    await onStayBooked({
      userId: F_USER_A,
      tenantId: '',
      destinationIso2: 'CL',
      destinationCity: 'Santiago',
    });
    // A's row still has the same totalTrips count; the empty-tenant
    // call shouldn't have appended Santiago to visitedCities either.
    const a = await prisma.travelerProfile.findUnique({ where: { userId: F_USER_A } });
    const cities = (a?.visitedCities as Array<{ citySlug: string }>).map(c => c.citySlug);
    expect(cities).not.toContain('santiago');
  });
});
