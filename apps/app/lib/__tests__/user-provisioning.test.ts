/**
 * Tests for the inline auto-provisioning fallback used when a brand-new
 * Clerk user lands on `/api/agent/chat` before the `user.created`
 * webhook does.
 *
 * Mocks `@sendero/database` (Prisma) and `@clerk/nextjs/server`
 * (clerkClient) at module level so the helper can run against in-memory
 * fakes. Asserts the four meaningful paths:
 *   - existing user → fast path returns id
 *   - new user → Clerk fetch + upsert returns id
 *   - Clerk fetch fails → returns null (caller 401s)
 *   - phone-only sign-up (no email) → synthesized email allows upsert
 *
 * Run: `bun test apps/app/lib/__tests__/user-provisioning.test.ts`
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

interface FakeUserRow {
  id: string;
  clerkUserId: string | null;
  email: string;
}

const state = {
  users: new Map<string, FakeUserRow>(),
  clerkProfiles: new Map<
    string,
    {
      emailAddresses: Array<{ id: string; emailAddress: string }>;
      primaryEmailAddressId: string | null;
      phoneNumbers: Array<{ id: string; phoneNumber: string }>;
      primaryPhoneNumberId: string | null;
      firstName: string | null;
      lastName: string | null;
    }
  >(),
  clerkShouldThrow: false,
};

mock.module('@sendero/database', () => ({
  prisma: {
    user: {
      findUnique: async (args: { where: { clerkUserId: string } }) => {
        for (const u of state.users.values()) {
          if (u.clerkUserId === args.where.clerkUserId) return { id: u.id };
        }
        return null;
      },
      upsert: async (args: {
        where: { clerkUserId: string };
        create: { clerkUserId: string; email: string };
        update: { email: string };
      }) => {
        for (const u of state.users.values()) {
          if (u.clerkUserId === args.where.clerkUserId) {
            u.email = args.update.email;
            return { id: u.id };
          }
        }
        const id = `user_db_${state.users.size + 1}`;
        state.users.set(id, {
          id,
          clerkUserId: args.create.clerkUserId,
          email: args.create.email,
        });
        return { id };
      },
    },
  },
}));

mock.module('@clerk/nextjs/server', () => ({
  clerkClient: async () => ({
    users: {
      getUser: async (id: string) => {
        if (state.clerkShouldThrow) throw new Error('clerk unreachable');
        const profile = state.clerkProfiles.get(id);
        if (!profile) throw new Error(`user ${id} not found in fake clerk`);
        return {
          firstName: profile.firstName,
          lastName: profile.lastName,
          emailAddresses: profile.emailAddresses,
          primaryEmailAddressId: profile.primaryEmailAddressId,
          phoneNumbers: profile.phoneNumbers,
          primaryPhoneNumberId: profile.primaryPhoneNumberId,
        };
      },
    },
  }),
}));

const { provisionClerkUserId } = await import('../user-provisioning');

beforeEach(() => {
  state.users.clear();
  state.clerkProfiles.clear();
  state.clerkShouldThrow = false;
});

afterEach(() => {
  state.users.clear();
  state.clerkProfiles.clear();
});

describe('provisionClerkUserId', () => {
  test('fast path: existing User row → returns id without touching Clerk', async () => {
    state.users.set('user_db_existing', {
      id: 'user_db_existing',
      clerkUserId: 'user_clerk_1',
      email: 'sara@example.com',
    });
    const id = await provisionClerkUserId('user_clerk_1');
    expect(id).toBe('user_db_existing');
    // Clerk profile is empty — confirms fast path didn't call getUser.
    expect(state.clerkProfiles.size).toBe(0);
  });

  test('slow path: missing row + email on Clerk profile → upserts and returns id', async () => {
    state.clerkProfiles.set('user_clerk_new', {
      emailAddresses: [{ id: 'idn_1', emailAddress: 'new@example.com' }],
      primaryEmailAddressId: 'idn_1',
      phoneNumbers: [],
      primaryPhoneNumberId: null,
      firstName: 'Pat',
      lastName: 'New',
    });
    const id = await provisionClerkUserId('user_clerk_new');
    expect(id).toBeTruthy();
    const stored = state.users.get(id!);
    expect(stored?.email).toBe('new@example.com');
    expect(stored?.clerkUserId).toBe('user_clerk_new');
  });

  test('phone-only sign-up: no Clerk email → synthesized email so upsert succeeds', async () => {
    state.clerkProfiles.set('user_clerk_phone', {
      emailAddresses: [],
      primaryEmailAddressId: null,
      phoneNumbers: [{ id: 'idp_1', phoneNumber: '+15551234567' }],
      primaryPhoneNumberId: 'idp_1',
      firstName: null,
      lastName: null,
    });
    const id = await provisionClerkUserId('user_clerk_phone');
    expect(id).toBeTruthy();
    const stored = state.users.get(id!);
    expect(stored?.email).toMatch(/^clerk-user_clerk_phone@/);
  });

  test('clerk fetch failure → returns null (caller decides to 401)', async () => {
    state.clerkShouldThrow = true;
    const id = await provisionClerkUserId('user_clerk_unreachable');
    expect(id).toBeNull();
    expect(state.users.size).toBe(0);
  });

  test('empty clerkUserId → returns null fast', async () => {
    const id = await provisionClerkUserId('');
    expect(id).toBeNull();
  });
});
