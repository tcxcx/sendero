/**
 * Tests for the Slack→Sendero user resolver.
 *
 * Mocks `@sendero/database` (Prisma) and `@sendero/slack` (WebClient
 * factory) at module level via `mock.module` so the resolver under
 * test wires up to controllable fakes. No real network or DB.
 *
 * Run: `bun test apps/app/lib/slack-user-mapping.test.ts`
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

// ─────────────────────────────────────────────────────────────────────
// Module mocks — must be installed before importing the unit under test
// ─────────────────────────────────────────────────────────────────────

interface SlackUserBindingRow {
  tenantId: string;
  slackTeamId: string;
  slackUserId: string;
  senderoUserId: string;
  email: string | null;
}

interface UserRow {
  id: string;
  email: string;
  source: string;
}

interface ChannelIdentityRow {
  id: string;
  tenantId: string;
  kind: string;
  externalUserId: string;
  userId: string;
  metadata: Record<string, unknown>;
}

const state = {
  bindings: new Map<string, SlackUserBindingRow>(),
  usersById: new Map<string, UserRow>(),
  usersByEmail: new Map<string, UserRow>(),
  channelIdentities: new Map<string, ChannelIdentityRow>(),
  /** Counter used to generate unique User.id values from create calls. */
  nextUserSeq: 1,
  nextChannelIdentitySeq: 1,
  /** Set by individual tests to control the Slack stub. */
  slackUsersInfo: mock(async (_args: { user: string }) => ({
    ok: true,
    user: { id: 'U_DEFAULT', profile: { email: null as string | null } },
  })),
  createSlackClient: mock((_token: string) => ({
    users: { info: state.slackUsersInfo as unknown as (a: { user: string }) => unknown },
  })),
  ensureTravelerWallet: mock(async (_args: { userId: string }) => ({ walletId: 'wallet_test' })),
};

function bindingKey(tenantId: string, slackTeamId: string, slackUserId: string): string {
  return `${tenantId}::${slackTeamId}::${slackUserId}`;
}

const prismaStub = {
  slackUserBinding: {
    findUnique: mock(
      async (args: {
        where: {
          tenantId_slackTeamId_slackUserId: {
            tenantId: string;
            slackTeamId: string;
            slackUserId: string;
          };
        };
      }) => {
        const k = bindingKey(
          args.where.tenantId_slackTeamId_slackUserId.tenantId,
          args.where.tenantId_slackTeamId_slackUserId.slackTeamId,
          args.where.tenantId_slackTeamId_slackUserId.slackUserId
        );
        return state.bindings.get(k) ?? null;
      }
    ),
    create: mock(
      async (args: { data: SlackUserBindingRow }) => {
        const k = bindingKey(args.data.tenantId, args.data.slackTeamId, args.data.slackUserId);
        if (state.bindings.has(k)) {
          // Mimic Prisma P2002.
          throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
        }
        state.bindings.set(k, { ...args.data });
        return args.data;
      }
    ),
  },
  user: {
    findUnique: mock(async (args: { where: { email?: string; id?: string } }) => {
      if (args.where.email) return state.usersByEmail.get(args.where.email) ?? null;
      if (args.where.id) return state.usersById.get(args.where.id) ?? null;
      return null;
    }),
    create: mock(
      async (args: { data: { email: string; source: string }; select?: unknown }) => {
        if (state.usersByEmail.has(args.data.email)) {
          // Mimic Prisma P2002 on User.email unique.
          throw Object.assign(new Error('Unique constraint failed on email'), { code: 'P2002' });
        }
        const id = `usr_${state.nextUserSeq++}`;
        const row: UserRow = { id, email: args.data.email, source: args.data.source };
        state.usersById.set(id, row);
        state.usersByEmail.set(row.email, row);
        return { id, email: row.email, source: row.source };
      }
    ),
  },
  channelIdentity: {
    upsert: mock(
      async (args: {
        where: {
          tenantId_kind_externalUserId: {
            tenantId: string;
            kind: string;
            externalUserId: string;
          };
        };
        create: {
          tenantId: string;
          kind: string;
          externalUserId: string;
          userId: string;
          metadata: Record<string, unknown>;
        };
        update: {
          userId: string;
          metadata: Record<string, unknown>;
        };
        select?: unknown;
      }) => {
        const key = `${args.where.tenantId_kind_externalUserId.tenantId}::${args.where.tenantId_kind_externalUserId.kind}::${args.where.tenantId_kind_externalUserId.externalUserId}`;
        const existing = state.channelIdentities.get(key);
        if (existing) {
          existing.userId = args.update.userId;
          existing.metadata = args.update.metadata;
          return { id: existing.id };
        }
        const row: ChannelIdentityRow = {
          id: `ci_${state.nextChannelIdentitySeq++}`,
          tenantId: args.create.tenantId,
          kind: args.create.kind,
          externalUserId: args.create.externalUserId,
          userId: args.create.userId,
          metadata: args.create.metadata,
        };
        state.channelIdentities.set(key, row);
        return { id: row.id };
      }
    ),
  },
};

mock.module('@sendero/database', () => ({ prisma: prismaStub }));
mock.module('@sendero/slack', () => ({
  createSlackClient: state.createSlackClient,
}));
mock.module('@sendero/tools/ensure-traveler-wallet', () => ({
  ensureTravelerWallet: state.ensureTravelerWallet,
}));

// Now import the unit under test (after mocks are installed).
const { resolveSenderoUser } = await import('./slack-user-mapping');

// ─────────────────────────────────────────────────────────────────────
// Helpers + fixtures
// ─────────────────────────────────────────────────────────────────────

const T = 'tenant_acme';
const TEAM = 'T08X5JKLM';
const SLACK_USER = 'U09H4WXZ7';
const TOKEN = 'xoxb-bot-token';
const FALLBACK = 'usr_admin_authed';

beforeEach(() => {
  state.bindings.clear();
  state.usersById.clear();
  state.usersByEmail.clear();
  state.channelIdentities.clear();
  state.nextUserSeq = 1;
  state.nextChannelIdentitySeq = 1;
  // Reset stub call counters.
  state.slackUsersInfo.mockClear();
  state.createSlackClient.mockClear();
  state.ensureTravelerWallet.mockClear();
  prismaStub.slackUserBinding.findUnique.mockClear();
  prismaStub.slackUserBinding.create.mockClear();
  prismaStub.user.findUnique.mockClear();
  prismaStub.user.create.mockClear();
  prismaStub.channelIdentity.upsert.mockClear();
  // Default Slack stub returns a generic user with no email.
  state.slackUsersInfo.mockImplementation(async () => ({
    ok: true,
    user: { id: SLACK_USER, profile: { email: null } },
  }));
});

afterEach(() => {
  // Sanity guard — the fallback admin row should never accidentally
  // be created by the resolver itself.
  expect(state.usersById.get(FALLBACK)).toBeUndefined();
});

// ─────────────────────────────────────────────────────────────────────
// Behaviour
// ─────────────────────────────────────────────────────────────────────

describe('resolveSenderoUser', () => {
  test('cache hit returns immediately, no Slack call', async () => {
    state.bindings.set(bindingKey(T, TEAM, SLACK_USER), {
      tenantId: T,
      slackTeamId: TEAM,
      slackUserId: SLACK_USER,
      senderoUserId: 'usr_cached',
      email: 'cached@acme.com',
    });

    const out = await resolveSenderoUser({
      tenantId: T,
      slackTeamId: TEAM,
      slackUserId: SLACK_USER,
      botToken: TOKEN,
      fallbackUserId: FALLBACK,
    });

    expect(out).toEqual({
      senderoUserId: 'usr_cached',
      email: 'cached@acme.com',
      provisional: false,
      channelIdentityId: 'ci_1',
    });
    expect(state.slackUsersInfo).not.toHaveBeenCalled();
    expect(prismaStub.user.create).not.toHaveBeenCalled();
    expect(prismaStub.slackUserBinding.create).not.toHaveBeenCalled();
    expect(prismaStub.channelIdentity.upsert).toHaveBeenCalled();
    expect(state.ensureTravelerWallet).toHaveBeenCalledWith({ userId: 'usr_cached' });
  });

  test('Slack returns email + existing Sendero User → returns existing user, no provisioning', async () => {
    // Pre-seed an existing user with this email.
    const existing: UserRow = { id: 'usr_existing', email: 'alice@acme.com', source: 'native' };
    state.usersById.set(existing.id, existing);
    state.usersByEmail.set(existing.email, existing);

    state.slackUsersInfo.mockImplementation(async () => ({
      ok: true,
      user: { id: SLACK_USER, profile: { email: 'alice@acme.com' } },
    }));

    const out = await resolveSenderoUser({
      tenantId: T,
      slackTeamId: TEAM,
      slackUserId: SLACK_USER,
      botToken: TOKEN,
      fallbackUserId: FALLBACK,
    });

    expect(out.senderoUserId).toBe('usr_existing');
    expect(out.email).toBe('alice@acme.com');
    expect(out.provisional).toBe(false);
    expect(out.channelIdentityId).toBe('ci_1');
    expect(prismaStub.user.create).not.toHaveBeenCalled();
    // Binding cache populated.
    expect(state.bindings.get(bindingKey(T, TEAM, SLACK_USER))?.senderoUserId).toBe('usr_existing');
  });

  test('Slack returns email + no existing User → auto-provisions, returns new user with provisional=true', async () => {
    state.slackUsersInfo.mockImplementation(async () => ({
      ok: true,
      user: { id: SLACK_USER, profile: { email: 'newhire@acme.com' } },
    }));

    const out = await resolveSenderoUser({
      tenantId: T,
      slackTeamId: TEAM,
      slackUserId: SLACK_USER,
      botToken: TOKEN,
      fallbackUserId: FALLBACK,
    });

    expect(out.provisional).toBe(true);
    expect(out.email).toBe('newhire@acme.com');
    expect(out.senderoUserId).toMatch(/^usr_/);
    expect(out.channelIdentityId).toBe('ci_1');
    // The created row uses the real email and source='slack'.
    const createdRow = state.usersByEmail.get('newhire@acme.com');
    expect(createdRow?.source).toBe('slack');
  });

  test('Slack returns no email → provisions with deterministic placeholder email', async () => {
    state.slackUsersInfo.mockImplementation(async () => ({
      ok: true,
      user: { id: SLACK_USER, profile: { email: null } },
    }));

    const out = await resolveSenderoUser({
      tenantId: T,
      slackTeamId: TEAM,
      slackUserId: SLACK_USER,
      botToken: TOKEN,
      fallbackUserId: FALLBACK,
    });

    expect(out.provisional).toBe(true);
    expect(out.email).toBeNull();
    expect(out.channelIdentityId).toBe('ci_1');
    const placeholder = `slack-${SLACK_USER.toLowerCase()}@${TEAM.toLowerCase()}.slack-provisional.sendero.travel`;
    expect(state.usersByEmail.get(placeholder)).toBeDefined();
    // Same Slack user resolved twice produces the same placeholder
    // and re-uses the existing cached binding row.
    const out2 = await resolveSenderoUser({
      tenantId: T,
      slackTeamId: TEAM,
      slackUserId: SLACK_USER,
      botToken: TOKEN,
      fallbackUserId: FALLBACK,
    });
    expect(out2.senderoUserId).toBe(out.senderoUserId);
    expect(out2.provisional).toBe(false);
    expect(out2.channelIdentityId).toBe(out.channelIdentityId);
  });

  test('Slack call throws → fallback to authedUserId, logs warn (does not bubble)', async () => {
    state.slackUsersInfo.mockImplementation(async () => {
      throw new Error('slack network error');
    });

    const warnSpy = mock((..._args: unknown[]) => {});
    const origWarn = console.warn;
    console.warn = warnSpy as unknown as typeof console.warn;
    try {
      const out = await resolveSenderoUser({
        tenantId: T,
        slackTeamId: TEAM,
        slackUserId: SLACK_USER,
        botToken: TOKEN,
        fallbackUserId: FALLBACK,
      });
      expect(out).toEqual({
        senderoUserId: FALLBACK,
        email: null,
        provisional: false,
        channelIdentityId: 'ci_1',
      });
    } finally {
      console.warn = origWarn;
    }
    expect(warnSpy).toHaveBeenCalled();
    // No binding written on the failure path, but the fallback user is
    // still anchored to the Slack channel identity for future repair.
    expect(state.bindings.size).toBe(0);
    expect(state.channelIdentities.size).toBe(1);
  });

  test('idempotency: parallel resolves with same args do not create two bindings', async () => {
    state.slackUsersInfo.mockImplementation(async () => ({
      ok: true,
      user: { id: SLACK_USER, profile: { email: 'parallel@acme.com' } },
    }));

    const [a, b] = await Promise.all([
      resolveSenderoUser({
        tenantId: T,
        slackTeamId: TEAM,
        slackUserId: SLACK_USER,
        botToken: TOKEN,
        fallbackUserId: FALLBACK,
      }),
      resolveSenderoUser({
        tenantId: T,
        slackTeamId: TEAM,
        slackUserId: SLACK_USER,
        botToken: TOKEN,
        fallbackUserId: FALLBACK,
      }),
    ]);

    // Both calls resolve to the same User; only one binding row exists.
    expect(a.senderoUserId).toBe(b.senderoUserId);
    expect(state.bindings.size).toBe(1);
    // And only one User row was created (the second call hit the
    // unique-violation re-read path).
    expect(state.usersByEmail.size).toBe(1);
  });
});
