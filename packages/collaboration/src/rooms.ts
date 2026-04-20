/**
 * Room naming conventions + per-room shape.
 *
 * A Sendero room is a group trip's shared workspace. Room id encodes
 * tenantId + tripId so Liveblocks session auth can enforce tenant
 * isolation on the server: users can only join rooms where their
 * ChannelIdentity.tenantId matches.
 *
 * Presence + storage shapes mirror the traveler's mental model — who
 * is viewing, whose cursor is where, and the itinerary document that
 * the agent + human collaborators share.
 */

export function roomIdForTrip(tenantId: string, tripId: string): string {
  return `sendero:${tenantId}:trip:${tripId}`;
}

export function parseRoomId(roomId: string): { tenantId: string; tripId: string } | null {
  const match = /^sendero:([^:]+):trip:(.+)$/.exec(roomId);
  if (!match) return null;
  return { tenantId: match[1], tripId: match[2] };
}

/**
 * What each present user broadcasts. Liveblocks requires presence to be
 * JSON-serializable — all fields are primitives (nested objects must be
 * flattened).
 */
export type TripPresence = {
  userId: string;
  displayName: string;
  role: 'traveler' | 'agent' | 'approver' | 'guest';
  cursorX: number | null;
  cursorY: number | null;
  focusedSection: 'flights' | 'hotels' | 'ground' | 'notes' | null;
  [key: string]: string | number | boolean | null;
};

/** Shared storage — the agent + travelers mutate this together. */
export interface TripStorage {
  itineraryVersion: number;
  notes: string;
  /** Segment ids the group has "liked" — fed back into the agent prompt. */
  likedSegmentIds: string[];
  /** Segment ids explicitly rejected by the group. */
  rejectedSegmentIds: string[];
  /** Freestyle chat from travelers to each other (agent reads too). */
  messages: Array<{
    id: string;
    authorUserId: string;
    authorDisplayName: string;
    at: number;
    body: string;
  }>;
}

export const INITIAL_TRIP_STORAGE: TripStorage = {
  itineraryVersion: 0,
  notes: '',
  likedSegmentIds: [],
  rejectedSegmentIds: [],
  messages: [],
};
