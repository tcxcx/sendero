/**
 * Server-side Liveblocks helpers.
 *
 * The consuming app exposes an auth endpoint at
 * `/api/liveblocks-auth` that calls `issueSession()` with a Clerk-
 * authenticated user. We stamp tenantId onto the session so the
 * Liveblocks access token is scoped to that tenant's rooms only.
 */

import { Liveblocks } from '@liveblocks/node';

import {
  parseRoomId,
  roomIdForReservation,
  roomIdForRun,
  roomIdForSupportCase,
  roomIdForTrip,
  roomIdForWorkspace,
} from './rooms';

let _client: Liveblocks | null | undefined;

function getClient(): Liveblocks | null {
  if (_client !== undefined) return _client;
  const secret = process.env.LIVEBLOCKS_SECRET_KEY || null;
  if (!secret) {
    _client = null;
    return null;
  }
  _client = new Liveblocks({ secret });
  return _client;
}

export interface IssueSessionArgs {
  userId: string; // Clerk user id — becomes the Liveblocks user id
  tenantId: string;
  displayName: string;
  avatarUrl?: string | null;
  role?: 'traveler' | 'operator' | 'admin' | 'finance' | 'agent' | 'member';
  /** Room ids the user may access. Use `roomIdForTrip()` to build them. */
  roomIds: string[];
}

export interface IssuedSession {
  /** Signed access token — send to the client. */
  token: string;
}

export interface IdentifySessionArgs {
  userId: string;
  tenantId: string;
  displayName: string;
  avatarUrl?: string | null;
  role?: 'traveler' | 'operator' | 'admin' | 'finance' | 'agent' | 'member';
  groupIds?: string[];
}

/**
 * Mint a scoped Liveblocks session. Every room on the allowlist is
 * verified to belong to `tenantId` before access is granted so a
 * misconfigured caller can't issue tokens for other tenants' trips.
 */
export async function issueSession(args: IssueSessionArgs): Promise<IssuedSession> {
  const client = getClient();
  if (!client) {
    throw new Error(
      '@sendero/collaboration: LIVEBLOCKS_SECRET_KEY is not set — cannot issue session'
    );
  }

  for (const rid of args.roomIds) {
    const parsed = parseRoomId(rid);
    if (!parsed || parsed.tenantId !== args.tenantId) {
      throw new Error(
        `room ${rid} does not belong to tenant ${args.tenantId} — refusing to issue session`
      );
    }
  }

  const session = client.prepareSession(args.userId, {
    userInfo: {
      name: args.displayName,
      avatar: args.avatarUrl ?? undefined,
      color: colorForUser(args.userId),
      role: liveblocksRole(args.role),
      teamId: args.tenantId,
      kind: 'human',
    },
  });

  for (const rid of args.roomIds) {
    session.allow(rid, session.FULL_ACCESS);
  }

  const response = await session.authorize();
  if (response.status !== 200) {
    throw new Error(`Liveblocks session authorize failed: ${response.status}`);
  }
  return { token: JSON.parse(response.body).token };
}

/**
 * Mint an ID token for project-level Liveblocks features such as inbox
 * notifications. These auth calls may not include a room id, so room-scoped
 * access tokens are the wrong shape.
 */
export async function identifySession(args: IdentifySessionArgs): Promise<IssuedSession> {
  const client = getClient();
  if (!client) {
    throw new Error(
      '@sendero/collaboration: LIVEBLOCKS_SECRET_KEY is not set — cannot identify user'
    );
  }

  const response = await client.identifyUser(
    {
      userId: args.userId,
      groupIds: [`tenant:${args.tenantId}`, ...(args.groupIds ?? [])],
    },
    {
      userInfo: {
        name: args.displayName,
        avatar: args.avatarUrl ?? undefined,
        color: colorForUser(args.userId),
        role: liveblocksRole(args.role),
        teamId: args.tenantId,
        kind: 'human',
      },
    }
  );
  if (response.status !== 200) {
    throw new Error(`Liveblocks identify user failed: ${response.status}`);
  }
  return { token: JSON.parse(response.body).token };
}

function liveblocksRole(role: IdentifySessionArgs['role']) {
  if (role === 'admin' || role === 'finance' || role === 'traveler' || role === 'agent') {
    return role;
  }
  return 'operator';
}

function colorForUser(id: string): string {
  const palette = ['#cc4b37', '#1f7a69', '#7c5c2e', '#375a9e', '#9a3f72', '#5c6f2f'];
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length];
}

/** Convenience re-exports so route handlers don't need the /rooms subpath. */
export {
  roomIdForReservation,
  roomIdForRun,
  roomIdForSupportCase,
  roomIdForTrip,
  roomIdForWorkspace,
  parseRoomId,
};

/**
 * Ensure a room exists (idempotent). Call once when a group trip is
 * created so the first visitor doesn't race room bootstrap.
 */
export async function ensureRoom(args: {
  tenantId: string;
  tripId: string;
  /** Default access for tenant members. Liveblocks requires a fixed tuple. */
  defaultAccesses?: [] | ['room:read', 'room:presence:write'] | ['room:write'];
  title?: string;
  url?: string;
}): Promise<void> {
  const client = getClient();
  if (!client) return;
  const roomId = roomIdForTrip(args.tenantId, args.tripId);
  await client.getOrCreateRoom(roomId, {
    defaultAccesses: args.defaultAccesses ?? [],
    metadata: {
      tenantId: args.tenantId,
      kind: 'trip',
      tripId: args.tripId,
      title: args.title ?? `Trip ${args.tripId.slice(0, 8)}`,
      url: args.url ?? `/dashboard/trips/${args.tripId}`,
    },
  });
}

/**
 * Trigger a Liveblocks inbox notification on the support-agent user
 * for a freshly-queued operator handoff. Fire-and-forget — when the
 * Liveblocks secret is unset (test envs) this returns silently.
 *
 * The room id MUST come from `roomIdForSupportCase(tenantId, handoffId)`
 * so the notification fans out to the right operator surfaces (the
 * fanout consumer at `apps/app/lib/liveblocks-webhook-fanout.ts` keys
 * on this naming convention).
 */
export async function notifyOperatorHandoff(args: {
  tenantId: string;
  handoffId: string;
  liveblocksRoomId: string;
  title: string;
  message: string;
  url: string;
  /**
   * Operator user ids (Clerk userIds) to wake. When supplied, each
   * gets its own inbox notification — this is how the bell in
   * `liveblocks-inbox.tsx` actually lights up for a signed-in
   * operator. The legacy `agent:customer-support` notification is
   * still emitted so existing fanout consumers keep their handle.
   */
  operatorUserIds?: readonly string[];
}): Promise<void> {
  const client = getClient();
  if (!client) return;
  const activityData = {
    title: args.title,
    message: args.message,
    provider: 'sendero',
    url: args.url,
  } as const;
  const tasks: Promise<unknown>[] = [
    client.triggerInboxNotification({
      userId: 'agent:customer-support',
      kind: '$handoffRequired',
      subjectId: args.handoffId,
      roomId: args.liveblocksRoomId,
      activityData,
    }),
  ];
  for (const userId of args.operatorUserIds ?? []) {
    if (!userId) continue;
    tasks.push(
      client.triggerInboxNotification({
        userId,
        kind: '$handoffRequired',
        subjectId: args.handoffId,
        roomId: args.liveblocksRoomId,
        activityData,
      })
    );
  }
  await Promise.allSettled(tasks);
}

/** Ensure the tenant-wide dashboard room exists. */
export async function ensureWorkspaceRoom(args: { tenantId: string }): Promise<void> {
  const client = getClient();
  if (!client) return;
  const roomId = roomIdForWorkspace(args.tenantId);
  await client.getOrCreateRoom(roomId, {
    defaultAccesses: [],
    metadata: {
      tenantId: args.tenantId,
      kind: 'workspace',
      scope: 'workspace',
      title: 'Workspace',
      url: '/dashboard',
    },
  });
}

export async function ensureRunRoom(args: {
  tenantId: string;
  runId: string;
  tripId?: string;
  title?: string;
}): Promise<void> {
  await ensureAuxiliaryRoom({
    tenantId: args.tenantId,
    roomId: roomIdForRun(args.tenantId, args.runId),
    metadata: {
      kind: 'run',
      runId: args.runId,
      tripId: args.tripId ?? '',
      title: args.title ?? `Run ${args.runId.slice(0, 8)}`,
      url: args.tripId ? `/dashboard/trips/${args.tripId}` : '/dashboard/console',
    },
  });
}

export async function ensureReservationRoom(args: {
  tenantId: string;
  reservationId: string;
  tripId?: string;
  title?: string;
}): Promise<void> {
  await ensureAuxiliaryRoom({
    tenantId: args.tenantId,
    roomId: roomIdForReservation(args.tenantId, args.reservationId),
    metadata: {
      kind: 'reservation',
      reservationId: args.reservationId,
      tripId: args.tripId ?? '',
      title: args.title ?? `Reservation ${args.reservationId.slice(0, 8)}`,
      url: args.tripId ? `/dashboard/trips/${args.tripId}` : '/dashboard/trips',
    },
  });
}

export async function ensureSupportRoom(args: {
  tenantId: string;
  caseId: string;
  tripId?: string;
  title?: string;
}): Promise<void> {
  await ensureAuxiliaryRoom({
    tenantId: args.tenantId,
    roomId: roomIdForSupportCase(args.tenantId, args.caseId),
    metadata: {
      kind: 'support',
      caseId: args.caseId,
      tripId: args.tripId ?? '',
      title: args.title ?? `Support ${args.caseId.slice(0, 8)}`,
      url: args.tripId ? `/dashboard/inbox/${args.tripId}` : '/dashboard/inbox',
    },
  });
}

async function ensureAuxiliaryRoom(args: {
  tenantId: string;
  roomId: string;
  metadata: Record<string, string>;
}): Promise<void> {
  const client = getClient();
  if (!client) return;
  await client.getOrCreateRoom(args.roomId, {
    defaultAccesses: [],
    metadata: {
      tenantId: args.tenantId,
      ...args.metadata,
    },
  });
}

export async function setAgentPresence(args: {
  roomId: string;
  userId: string;
  data: Record<string, string | number | boolean | null>;
  userInfo: { name: string; avatar?: string; color?: string };
  ttl?: number;
}): Promise<void> {
  const secret = process.env.LIVEBLOCKS_SECRET_KEY || null;
  if (!secret) return;
  const response = await fetch(
    `https://api.liveblocks.io/v2/rooms/${encodeURIComponent(args.roomId)}/presence`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${secret}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        userId: args.userId,
        data: args.data,
        userInfo: args.userInfo,
        ttl: args.ttl ?? 60,
      }),
    }
  );
  if (!response.ok) {
    throw new Error(`Liveblocks agent presence failed: ${response.status}`);
  }
}
