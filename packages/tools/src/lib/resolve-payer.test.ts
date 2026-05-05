import { describe, expect, test, mock, beforeEach } from 'bun:test';

// Mock @sendero/database BEFORE importing the unit under test. bun-test
// requires this ordering for `mock.module` to take effect.
const findUniqueTrip = mock(async (_args: unknown) => null as unknown);
const findUniqueTenant = mock(async (_args: unknown) => null as unknown);

mock.module('@sendero/database', () => ({
  prisma: {
    trip: { findUnique: findUniqueTrip },
    tenant: { findUnique: findUniqueTenant },
  },
}));

const { resolvePayer, PayerResolutionError } = await import('./resolve-payer');

beforeEach(() => {
  findUniqueTrip.mockClear();
  findUniqueTenant.mockClear();
});

describe('resolvePayer — override path', () => {
  test('explicit tenant override short-circuits (no DB hit)', async () => {
    const r = await resolvePayer({ tenantId: 't1', override: 'tenant' });
    expect(r.type).toBe('tenant');
    expect(r.source).toBe('override');
    expect(findUniqueTrip).not.toHaveBeenCalled();
    expect(findUniqueTenant).not.toHaveBeenCalled();
  });

  test('explicit traveler override requires travelerUserId', async () => {
    await expect(resolvePayer({ tenantId: 't1', override: 'traveler' })).rejects.toThrow(
      PayerResolutionError
    );
  });

  test('explicit traveler override with travelerUserId resolves', async () => {
    const r = await resolvePayer({
      tenantId: 't1',
      travelerUserId: 'u1',
      override: 'traveler',
    });
    expect(r.type).toBe('traveler');
    expect(r.travelerUserId).toBe('u1');
  });
});

describe('resolvePayer — trip path', () => {
  test('Trip.paymentMode=tenant wins', async () => {
    findUniqueTrip.mockImplementationOnce(async () => ({
      paymentMode: 'tenant',
      tenantId: 't1',
    }));
    const r = await resolvePayer({ tripId: 'trip1', tenantId: 't1' });
    expect(r.type).toBe('tenant');
    expect(r.source).toBe('trip');
    expect(findUniqueTenant).not.toHaveBeenCalled();
  });

  test('Trip.paymentMode=traveler resolves with traveler id', async () => {
    findUniqueTrip.mockImplementationOnce(async () => ({
      paymentMode: 'traveler',
      tenantId: 't1',
    }));
    const r = await resolvePayer({ tripId: 'trip1', tenantId: 't1', travelerUserId: 'u1' });
    expect(r.type).toBe('traveler');
    expect(r.source).toBe('trip');
  });

  test('Trip.paymentMode=traveler without travelerUserId throws', async () => {
    findUniqueTrip.mockImplementationOnce(async () => ({
      paymentMode: 'traveler',
      tenantId: 't1',
    }));
    await expect(resolvePayer({ tripId: 'trip1', tenantId: 't1' })).rejects.toThrow(
      'traveler-paid mode'
    );
  });

  test('Trip.paymentMode=split throws split_unsupported (until split-resolver lands)', async () => {
    findUniqueTrip.mockImplementationOnce(async () => ({
      paymentMode: 'split',
      tenantId: 't1',
    }));
    await expect(resolvePayer({ tripId: 'trip1', tenantId: 't1' })).rejects.toThrow(
      'split-payer mode'
    );
  });

  test('cross-tenant trip lookup fails loud (defense-in-depth)', async () => {
    findUniqueTrip.mockImplementationOnce(async () => ({
      paymentMode: 'tenant',
      tenantId: 'OTHER_TENANT',
    }));
    await expect(resolvePayer({ tripId: 'trip1', tenantId: 't1' })).rejects.toThrow(
      'belongs to a different tenant'
    );
  });
});

describe('resolvePayer — tenant default path', () => {
  test('falls through to Tenant.defaultPaymentMode=traveler', async () => {
    findUniqueTrip.mockImplementationOnce(async () => null);
    findUniqueTenant.mockImplementationOnce(async () => ({ defaultPaymentMode: 'traveler' }));
    const r = await resolvePayer({ tripId: 'trip1', tenantId: 't1', travelerUserId: 'u1' });
    expect(r.type).toBe('traveler');
    expect(r.source).toBe('tenant');
  });

  test('Tenant.defaultPaymentMode=traveler without travelerUserId throws', async () => {
    findUniqueTrip.mockImplementationOnce(async () => null);
    findUniqueTenant.mockImplementationOnce(async () => ({ defaultPaymentMode: 'traveler' }));
    await expect(resolvePayer({ tripId: 'trip1', tenantId: 't1' })).rejects.toThrow(
      'default is traveler-paid'
    );
  });

  test('Tenant.defaultPaymentMode=tenant resolves without traveler id', async () => {
    findUniqueTrip.mockImplementationOnce(async () => null);
    findUniqueTenant.mockImplementationOnce(async () => ({ defaultPaymentMode: 'tenant' }));
    const r = await resolvePayer({ tripId: 'trip1', tenantId: 't1' });
    expect(r.type).toBe('tenant');
    expect(r.source).toBe('tenant');
  });
});

describe('resolvePayer — legacy fallback', () => {
  test('null trip + null tenant defaults to traveler when traveler context exists', async () => {
    findUniqueTrip.mockImplementationOnce(async () => null);
    findUniqueTenant.mockImplementationOnce(async () => null);
    const r = await resolvePayer({ tripId: 'trip1', tenantId: 't1', travelerUserId: 'u1' });
    expect(r.type).toBe('traveler');
    expect(r.source).toBe('fallback');
  });

  test('null trip + null tenant + no travelerUserId throws (cannot fall back blind)', async () => {
    findUniqueTrip.mockImplementationOnce(async () => null);
    findUniqueTenant.mockImplementationOnce(async () => null);
    await expect(resolvePayer({ tripId: 'trip1', tenantId: 't1' })).rejects.toThrow(
      'cannot fall back to traveler-pay'
    );
  });

  test('no tripId + tenant lookup empty + traveler present → traveler fallback', async () => {
    findUniqueTenant.mockImplementationOnce(async () => null);
    const r = await resolvePayer({ tenantId: 't1', travelerUserId: 'u1' });
    expect(r.type).toBe('traveler');
    expect(r.source).toBe('fallback');
    expect(findUniqueTrip).not.toHaveBeenCalled();
  });
});
