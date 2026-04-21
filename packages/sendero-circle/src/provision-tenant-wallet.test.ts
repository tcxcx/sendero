import { test, expect, beforeEach, afterEach } from 'bun:test';
import { prisma } from '@sendero/database';
import { provisionTenantWallet, type CircleSdkLike } from './provision-tenant-wallet';

const TEST_TENANT_ID = 'provision-test-' + Date.now();

beforeEach(async () => {
  // Create a test tenant — required because CircleWallet.tenantId FKs to
  // Tenant.id. Required Tenant fields per schema.prisma: clerkOrgId,
  // slug, displayName (billingTier has @default(free) so it's optional).
  await prisma.tenant.upsert({
    where: { id: TEST_TENANT_ID },
    create: {
      id: TEST_TENANT_ID,
      slug: TEST_TENANT_ID,
      displayName: 'Provision Test',
      billingTier: 'free',
      clerkOrgId: `org_${TEST_TENANT_ID}`,
    },
    update: {},
  });
});

afterEach(async () => {
  await prisma.circleWallet.deleteMany({ where: { tenantId: TEST_TENANT_ID } });
  await prisma.tenant.delete({ where: { id: TEST_TENANT_ID } }).catch(() => void 0);
});

function makeMockSdk(opts: {
  address?: string;
  walletSetId?: string;
  walletId?: string;
} = {}): CircleSdkLike & { walletSetCalls: number; walletCalls: number } {
  const state = { walletSetCalls: 0, walletCalls: 0 };
  const sdk = {
    createWalletSet: async () => {
      state.walletSetCalls += 1;
      return { data: { walletSet: { id: opts.walletSetId ?? 'wset_test' } } };
    },
    createWallets: async () => {
      state.walletCalls += 1;
      return {
        data: {
          wallets: [
            {
              id: opts.walletId ?? 'wallet_test',
              address: opts.address ?? '0x1234567890abcdef1234567890abcdef12345678',
            },
          ],
        },
      };
    },
    get walletSetCalls() {
      return state.walletSetCalls;
    },
    get walletCalls() {
      return state.walletCalls;
    },
  };
  return sdk as CircleSdkLike & { walletSetCalls: number; walletCalls: number };
}

test('provisionTenantWallet creates walletSet + wallet + persists CircleWallet row', async () => {
  const sdk = makeMockSdk();
  const result = await provisionTenantWallet({
    tenantId: TEST_TENANT_ID,
    clerkOrgId: `org_${TEST_TENANT_ID}`,
    sdk,
  });
  expect(result.alreadyExisted).toBe(false);
  expect(result.walletSetId).toBe('wset_test');
  expect(result.walletId).toBe('wallet_test');
  expect(result.address).toBe('0x1234567890abcdef1234567890abcdef12345678');

  const row = await prisma.circleWallet.findFirst({
    where: { tenantId: TEST_TENANT_ID, kind: 'treasury' },
  });
  expect(row).not.toBeNull();
  expect(row?.address).toBe('0x1234567890abcdef1234567890abcdef12345678');
});

test('provisionTenantWallet is idempotent on tenantId', async () => {
  const sdk = makeMockSdk();
  const first = await provisionTenantWallet({
    tenantId: TEST_TENANT_ID,
    clerkOrgId: `org_${TEST_TENANT_ID}`,
    sdk,
  });
  const second = await provisionTenantWallet({
    tenantId: TEST_TENANT_ID,
    clerkOrgId: `org_${TEST_TENANT_ID}`,
    sdk,
  });
  expect(first.alreadyExisted).toBe(false);
  expect(second.alreadyExisted).toBe(true);
  expect(second.address).toBe(first.address);
  // SDK should only have been called once in total.
  expect(sdk.walletSetCalls).toBe(1);
  expect(sdk.walletCalls).toBe(1);
});

test('provisionTenantWallet throws when SDK returns no walletSet id', async () => {
  const badSdk: CircleSdkLike = {
    createWalletSet: async () => ({ data: {} }),
    createWallets: async () => ({ data: { wallets: [] } }),
  };
  await expect(
    provisionTenantWallet({
      tenantId: TEST_TENANT_ID,
      clerkOrgId: `org_${TEST_TENANT_ID}`,
      sdk: badSdk,
    })
  ).rejects.toThrow(/walletSet/);
});
