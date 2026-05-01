import { type NextRequest, NextResponse } from 'next/server';

import { auth } from '@clerk/nextjs/server';
import { parseRoomId } from '@sendero/collaboration/server';
import { prisma } from '@sendero/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 10;

const AGENTS = new Map<
  string,
  { name: string; avatar?: string; color: string; role: string; kind: 'agent' }
>([
  [
    'agent:customer-support',
    {
      name: 'Customer Support Agent',
      color: '#1f7a69',
      role: 'agent',
      kind: 'agent',
    },
  ],
  [
    'agent:travel-planner',
    {
      name: 'Travel Planner Agent',
      color: '#cc4b37',
      role: 'agent',
      kind: 'agent',
    },
  ],
  [
    'agent:safety-reviewer',
    {
      name: 'Safety Reviewer Agent',
      color: '#9a3f72',
      role: 'agent',
      kind: 'agent',
    },
  ],
  [
    'agent:reservation-operator',
    {
      name: 'Reservation Operator Agent',
      color: '#375a9e',
      role: 'agent',
      kind: 'agent',
    },
  ],
  [
    'agent:support-copilot',
    {
      name: 'Support Copilot Agent',
      color: '#7c5c2e',
      role: 'agent',
      kind: 'agent',
    },
  ],
]);

const GROUPS = new Map<
  string,
  { name: string; avatar?: string; description: string; channel: string }
>([
  [
    'group:ops',
    {
      name: 'Operations',
      description: 'Trip operators watching quotes, bookings, handoffs, and run status.',
      channel: 'app',
    },
  ],
  [
    'group:support',
    {
      name: 'Customer Support',
      description: 'Support agents connected to app, WhatsApp, and Slack handoffs.',
      channel: 'support_agent',
    },
  ],
  [
    'group:safety',
    {
      name: 'Safety',
      description: 'Reviewers handling policy, duty of care, and travel risk.',
      channel: 'app',
    },
  ],
  [
    'group:finance',
    {
      name: 'Finance',
      description: 'Finance reviewers handling escrow, caps, invoices, and settlement.',
      channel: 'app',
    },
  ],
]);

type ResolveBody =
  | { kind: 'users'; userIds: string[] }
  | { kind: 'rooms'; roomIds: string[] }
  | { kind: 'groups'; groupIds: string[] }
  | { kind: 'mentions'; text?: string; roomId?: string };

export async function POST(req: NextRequest) {
  const { userId, orgId } = await auth();
  if (!userId || !orgId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const tenant = await prisma.tenant.findUnique({
    where: { clerkOrgId: orgId },
    select: { id: true, displayName: true, slug: true },
  });
  if (!tenant) return NextResponse.json({ error: 'tenant_not_found' }, { status: 404 });

  const body = (await req.json().catch(() => null)) as ResolveBody | null;
  if (!body?.kind) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  if (body.kind === 'users') {
    return NextResponse.json({
      users: await resolveUsers(tenant.id, body.userIds),
    });
  }

  if (body.kind === 'rooms') {
    return NextResponse.json({
      rooms: await resolveRooms(tenant.id, tenant.displayName, body.roomIds),
    });
  }

  if (body.kind === 'groups') {
    return NextResponse.json({
      groups: resolveGroups(body.groupIds),
    });
  }

  return NextResponse.json({
    suggestions: await resolveMentionSuggestions(tenant.id, body.text, body.roomId),
  });
}

async function resolveUsers(tenantId: string, userIds: string[]) {
  const humanIds = userIds.filter(userId => !AGENTS.has(userId));
  const users = humanIds.length
    ? await prisma.user.findMany({
        where: {
          clerkUserId: { in: humanIds },
          memberships: { some: { tenantId, status: 'active' } },
        },
        select: {
          clerkUserId: true,
          displayName: true,
          email: true,
          imageUrl: true,
          memberships: {
            where: { tenantId, status: 'active' },
            select: { role: true },
            take: 1,
          },
        },
      })
    : [];
  const byClerkId = new Map(users.map(user => [user.clerkUserId, user]));

  return userIds.map(userId => {
    const agent = AGENTS.get(userId);
    if (agent) return { ...agent, teamId: tenantId };

    const user = byClerkId.get(userId);
    if (!user) return undefined;
    const role = user.memberships[0]?.role ?? 'traveler';
    return {
      name: user.displayName || user.email,
      avatar: user.imageUrl ?? undefined,
      color: colorForId(userId),
      role: role === 'agency_admin' ? 'admin' : role,
      teamId: tenantId,
      kind: 'human',
    };
  });
}

async function resolveRooms(tenantId: string, tenantName: string, roomIds: string[]) {
  const parsedRooms = roomIds.map(roomId => ({ roomId, parsed: parseRoomId(roomId) }));
  const tripIds = parsedRooms
    .map(item => {
      if (item.parsed?.kind !== 'trip' || item.parsed.tenantId !== tenantId) return null;
      return item.parsed.tripId;
    })
    .filter((tripId): tripId is string => Boolean(tripId));
  const trips = tripIds.length
    ? await prisma.trip.findMany({
        where: { id: { in: tripIds }, tenantId },
        select: { id: true, status: true, intent: true, channelBindings: true },
      })
    : [];
  const tripsById = new Map(trips.map(trip => [trip.id, trip]));

  return parsedRooms.map(({ roomId, parsed }) => {
    if (!parsed || parsed.tenantId !== tenantId) return undefined;

    if (parsed.kind === 'workspace') {
      return {
        name: `${tenantName} workspace`,
        url: '/dashboard',
        kind: 'team',
        channels: ['app', 'slack', 'whatsapp', 'support_agent'],
      };
    }

    if (parsed.kind === 'run') {
      return {
        name: `Agent run ${parsed.runId.slice(0, 8)}`,
        url: '/dashboard/console',
        kind: 'run',
        channels: ['app', 'support_agent'],
        roomId,
      };
    }

    if (parsed.kind === 'reservation') {
      return {
        name: `Reservation ${parsed.reservationId.slice(0, 8)}`,
        url: '/dashboard/trips',
        kind: 'reservation',
        channels: ['app', 'slack', 'support_agent'],
        roomId,
      };
    }

    if (parsed.kind === 'support') {
      return {
        name: `Support case ${parsed.caseId.slice(0, 8)}`,
        url: '/dashboard/inbox',
        kind: 'support',
        channels: ['app', 'slack', 'whatsapp', 'support_agent'],
        roomId,
      };
    }

    const trip = tripsById.get(parsed.tripId);
    if (!trip) return undefined;
    const label = tripLabel(trip.intent, parsed.tripId);
    return {
      name: label,
      url: `/dashboard/trips/${parsed.tripId}`,
      kind: 'trip',
      status: trip.status,
      channels: channelLabels(trip.channelBindings),
      channelContexts: channelContexts(trip.channelBindings),
      roomId,
    };
  });
}

function resolveGroups(groupIds: string[]) {
  return groupIds.map(groupId => {
    const group = GROUPS.get(groupId);
    if (!group) return undefined;
    return group;
  });
}

async function resolveMentionSuggestions(tenantId: string, text?: string, roomId?: string) {
  const parsed = roomId ? parseRoomId(roomId) : null;
  if (parsed && parsed.tenantId !== tenantId) return [];

  const normalized = text?.trim().toLowerCase() ?? '';
  const members = await prisma.membership.findMany({
    where: {
      tenantId,
      status: 'active',
      user: normalized
        ? {
            OR: [
              { displayName: { contains: normalized, mode: 'insensitive' } },
              { email: { contains: normalized, mode: 'insensitive' } },
            ],
          }
        : undefined,
    },
    select: { user: { select: { clerkUserId: true } } },
    take: 20,
  });

  const agentIds = [...AGENTS.entries()]
    .filter(([id, agent]) => {
      if (!normalized) return true;
      return id.includes(normalized) || agent.name.toLowerCase().includes(normalized);
    })
    .map(([id]) => id);

  const groupIds = [...GROUPS.entries()]
    .filter(([id, group]) => {
      if (!normalized) return true;
      return (
        id.includes(normalized) ||
        group.name.toLowerCase().includes(normalized) ||
        group.description.toLowerCase().includes(normalized)
      );
    })
    .map(([id]) => id);

  return [
    ...members.map(member => member.user.clerkUserId).filter((id): id is string => Boolean(id)),
    ...agentIds,
    ...groupIds,
  ];
}

function tripLabel(intent: unknown, fallback: string): string {
  if (intent && typeof intent === 'object') {
    const data = intent as { origin?: string; destination?: string; dest?: string };
    const origin = data.origin;
    const destination = data.destination ?? data.dest;
    if (origin && destination) return `${origin} to ${destination}`;
  }
  return `Trip ${fallback.slice(0, 8)}`;
}

function channelLabels(channelBindings: unknown): string[] {
  const channels = new Set(['app', 'support_agent']);
  if (channelBindings && typeof channelBindings === 'object') {
    const data = channelBindings as Record<string, unknown>;
    for (const key of ['slack', 'whatsapp', 'email']) {
      if (data[key]) channels.add(key);
    }
    if (typeof data.primary === 'string') channels.add(data.primary);
  }
  return [...channels];
}

function channelContexts(channelBindings: unknown) {
  return channelLabels(channelBindings).map(source => ({
    source,
    mirrored: source !== 'app',
  }));
}

function colorForId(id: string): string {
  const palette = ['#cc4b37', '#1f7a69', '#7c5c2e', '#375a9e', '#9a3f72', '#5c6f2f'];
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length];
}
