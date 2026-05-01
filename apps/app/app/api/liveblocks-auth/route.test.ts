import { parseRoomId } from '@sendero/collaboration/rooms';

import { beforeEach, describe, expect, mock, test } from 'bun:test';

let clerkState: {
  userId: string | null;
  orgId: string | null;
  roles: Set<string>;
  user: {
    fullName: string | null;
    firstName: string | null;
    username: string | null;
    imageUrl: string | null;
    primaryEmailAddress?: { emailAddress: string } | null;
  } | null;
};

let tenantByOrg: Record<string, { id: string } | null>;
let trips: Array<{ id: string; tenantId: string }>;
let issuedSessions: Array<{
  userId: string;
  tenantId: string;
  displayName: string;
  avatarUrl: string | null;
  roomIds: string[];
}>;

mock.module('@clerk/nextjs/server', () => ({
  auth: async () => ({
    userId: clerkState.userId,
    orgId: clerkState.orgId,
    has: ({ role }: { role: string }) => clerkState.roles.has(role),
  }),
  currentUser: async () => clerkState.user,
}));

mock.module('@sendero/database', () => ({
  prisma: {
    tenant: {
      findUnique: async ({ where }: { where: { clerkOrgId: string } }) =>
        tenantByOrg[where.clerkOrgId] ?? null,
    },
    trip: {
      findFirst: async ({ where }: { where: { id: string; tenantId: string } }) =>
        trips.find(trip => trip.id === where.id && trip.tenantId === where.tenantId) ?? null,
    },
  },
}));

mock.module('@sendero/collaboration/server', () => ({
  parseRoomId,
  issueSession: async (args: (typeof issuedSessions)[number]) => {
    issuedSessions.push(args);
    return { token: 'liveblocks-token' };
  },
}));

const { POST } = await import('./route');

function request(room: string): Request {
  return new Request('https://app.sendero.test/api/liveblocks-auth', {
    method: 'POST',
    body: JSON.stringify({ room }),
  });
}

beforeEach(() => {
  clerkState = {
    userId: 'user_123',
    orgId: 'org_123',
    roles: new Set(['org:admin']),
    user: {
      fullName: 'Tomas Cordero',
      firstName: 'Tomas',
      username: 'tomas',
      imageUrl: 'https://img.example.com/tomas.png',
      primaryEmailAddress: { emailAddress: 'tomas@example.com' },
    },
  };
  tenantByOrg = { org_123: { id: 'ten_123' }, org_other: { id: 'ten_other' } };
  trips = [{ id: 'trip_123', tenantId: 'ten_123' }];
  issuedSessions = [];
});

describe('POST /api/liveblocks-auth', () => {
  test('issues a Clerk-scoped workspace room token for the active organization tenant', async () => {
    const response = await POST(request('sendero:ten_123:workspace') as never);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({ token: 'liveblocks-token', role: 'admin' });
    expect(issuedSessions).toHaveLength(1);
    expect(issuedSessions[0]).toMatchObject({
      userId: 'user_123',
      tenantId: 'ten_123',
      displayName: 'Tomas Cordero',
      avatarUrl: 'https://img.example.com/tomas.png',
      roomIds: ['sendero:ten_123:workspace'],
    });
  });

  test('blocks cross-tenant workspace rooms even when the user supplies a valid room id', async () => {
    const response = await POST(request('sendero:ten_other:workspace') as never);
    const json = await response.json();

    expect(response.status).toBe(403);
    expect(json.error).toBe('tenant_forbidden');
    expect(issuedSessions).toHaveLength(0);
  });

  test('checks trip existence inside the active tenant before issuing a trip room token', async () => {
    const response = await POST(request('sendero:ten_123:trip:trip_missing') as never);
    const json = await response.json();

    expect(response.status).toBe(404);
    expect(json.error).toBe('trip_not_found');
    expect(issuedSessions).toHaveLength(0);
  });
});
