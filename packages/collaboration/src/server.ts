/**
 * Server-side Liveblocks helpers.
 *
 * The consuming app exposes an auth endpoint at
 * `/api/liveblocks-auth` that calls `issueSession()` with a Clerk-
 * authenticated user. We stamp tenantId onto the session so the
 * Liveblocks access token is scoped to that tenant's rooms only.
 */

import { Liveblocks } from '@liveblocks/node';
import { parseRoomId, roomIdForTrip } from './rooms';

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
  /** Room ids the user may access. Use `roomIdForTrip()` to build them. */
  roomIds: string[];
}

export interface IssuedSession {
  /** Signed access token — send to the client. */
  token: string;
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

/** Convenience re-exports so route handlers don't need the /rooms subpath. */
export { roomIdForTrip, parseRoomId };

/**
 * Ensure a room exists (idempotent). Call once when a group trip is
 * created so the first visitor doesn't race room bootstrap.
 */
export async function ensureRoom(args: {
  tenantId: string;
  tripId: string;
  /** Default access for tenant members. Liveblocks requires a fixed tuple. */
  defaultAccesses?: ['room:read', 'room:presence:write'] | ['room:write'];
}): Promise<void> {
  const client = getClient();
  if (!client) return;
  const roomId = roomIdForTrip(args.tenantId, args.tripId);
  try {
    await client.getRoom(roomId);
  } catch {
    await client.createRoom(roomId, {
      defaultAccesses: args.defaultAccesses ?? ['room:write'],
      metadata: { tenantId: args.tenantId, tripId: args.tripId },
    });
  }
}
