import { parseRoomId } from '@sendero/collaboration/rooms';

import { beforeEach, describe, expect, mock, test } from 'bun:test';

let clerkState: { userId: string | null; orgId: string | null };
let tenantByOrg: Record<string, { id: string; displayName: string; slug: string } | null>;
let users: Array<{
  clerkUserId: string | null;
  displayName: string | null;
  email: string;
  imageUrl: string | null;
  memberships: Array<{ role: string }>;
}>;
let memberships: Array<{
  tenantId: string;
  status: string;
  user: { clerkUserId: string | null; displayName: string | null; email: string };
}>;
let trips: Array<{
  id: string;
  tenantId: string;
  status: string;
  intent: unknown;
  channelBindings: unknown;
}>;

mock.module('@clerk/nextjs/server', () => ({
  auth: async () => clerkState,
}));

mock.module('@sendero/collaboration/server', () => ({
  parseRoomId,
}));

mock.module('@sendero/database', () => ({
  prisma: {
    tenant: {
      findUnique: async ({ where }: { where: { clerkOrgId: string } }) =>
        tenantByOrg[where.clerkOrgId] ?? null,
    },
    user: {
      findMany: async ({ where }: { where: { clerkUserId: { in: string[] } } }) =>
        users.filter(user => user.clerkUserId && where.clerkUserId.in.includes(user.clerkUserId)),
    },
    membership: {
      findMany: async ({
        where,
      }: {
        where: { tenantId: string; status: string; user?: unknown };
      }) =>
        memberships.filter(membership => {
          if (membership.tenantId !== where.tenantId || membership.status !== where.status) {
            return false;
          }
          return true;
        }),
    },
    trip: {
      findMany: async ({ where }: { where: { tenantId: string; id: { in: string[] } } }) =>
        trips.filter(trip => trip.tenantId === where.tenantId && where.id.in.includes(trip.id)),
    },
  },
}));

const { POST } = await import('./route');

function request(body: unknown): Request {
  return new Request('https://app.sendero.test/api/liveblocks-resolve', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  clerkState = { userId: 'user_123', orgId: 'org_123' };
  tenantByOrg = {
    org_123: { id: 'ten_123', displayName: 'QA Corporate Travel', slug: 'qa-corporate' },
    org_other: { id: 'ten_other', displayName: 'QA Agency', slug: 'qa-agency' },
  };
  users = [
    {
      clerkUserId: 'user_123',
      displayName: 'Tomas Cordero',
      email: 'tomas@example.com',
      imageUrl: 'https://img.example.com/tomas.png',
      memberships: [{ role: 'agency_admin' }],
    },
  ];
  memberships = [
    {
      tenantId: 'ten_123',
      status: 'active',
      user: { clerkUserId: 'user_123', displayName: 'Tomas Cordero', email: 'tomas@example.com' },
    },
  ];
  trips = [
    {
      id: 'trip_123',
      tenantId: 'ten_123',
      status: 'draft',
      intent: { origin: 'SFO', destination: 'MEX' },
      channelBindings: { primary: 'slack', slack: { channelId: 'C123' } },
    },
  ];
});

describe('POST /api/liveblocks-resolve', () => {
  test('resolves human users and configured AI agents in request order', async () => {
    const response = await POST(
      request({
        kind: 'users',
        userIds: ['agent:customer-support', 'user_123', 'missing'],
      }) as never
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.users[0]).toMatchObject({
      name: 'Customer Support Agent',
      role: 'agent',
      kind: 'agent',
    });
    expect(json.users[1]).toMatchObject({
      name: 'Tomas Cordero',
      avatar: 'https://img.example.com/tomas.png',
      role: 'admin',
      kind: 'human',
    });
    expect(json.users[2]).toBeNull();
  });

  test('resolves workspace, trip, and support room deep links', async () => {
    const response = await POST(
      request({
        kind: 'rooms',
        roomIds: [
          'sendero:ten_123:workspace',
          'sendero:ten_123:trip:trip_123',
          'sendero:ten_123:support:case_123',
          'sendero:ten_other:workspace',
        ],
      }) as never
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.rooms[0]).toMatchObject({
      name: 'QA Corporate Travel workspace',
      url: '/dashboard',
      channels: ['app', 'slack', 'whatsapp', 'support_agent'],
    });
    expect(json.rooms[1]).toMatchObject({
      name: 'SFO to MEX',
      url: '/dashboard/trips/trip_123',
      kind: 'trip',
      channels: ['app', 'support_agent', 'slack'],
    });
    expect(json.rooms[2]).toMatchObject({
      name: 'Support case case_123',
      url: '/dashboard/inbox',
      kind: 'support',
    });
    expect(json.rooms[3]).toBeNull();
  });

  test('resolves groups and includes agents/groups in mention suggestions', async () => {
    const groupsResponse = await POST(
      request({ kind: 'groups', groupIds: ['group:support', 'group:finance', 'missing'] }) as never
    );
    const groupsJson = await groupsResponse.json();

    expect(groupsResponse.status).toBe(200);
    expect(groupsJson.groups[0]).toMatchObject({
      name: 'Customer Support',
      channel: 'support_agent',
    });
    expect(groupsJson.groups[1]).toMatchObject({ name: 'Finance' });
    expect(groupsJson.groups[2]).toBeNull();

    const mentionsResponse = await POST(
      request({
        kind: 'mentions',
        text: 'support',
        roomId: 'sendero:ten_123:trip:trip_123',
      }) as never
    );
    const mentionsJson = await mentionsResponse.json();

    expect(mentionsResponse.status).toBe(200);
    expect(mentionsJson.suggestions).toContain('agent:customer-support');
    expect(mentionsJson.suggestions).toContain('agent:support-copilot');
    expect(mentionsJson.suggestions).toContain('group:support');
  });
});
