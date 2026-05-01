'use client';

/**
 * Client-side Liveblocks provider + React hooks scoped to Sendero's
 * TripPresence + TripStorage shapes.
 *
 * The app mounts <TripRoomProvider tripId=… authEndpoint="/api/liveblocks-auth">
 * at a group trip page. Inside, consumers use:
 *   - useOthers()             → other travelers currently present
 *   - useSelf()               → current user's presence
 *   - useStorage()            → shared itinerary document
 *   - useMutation()           → edit the itinerary
 *   - useThreads() / Thread   → comments on segments
 */

import type { ReactNode } from 'react';

import { type BaseUserMeta, createClient, LiveList } from '@liveblocks/client';
import { createRoomContext } from '@liveblocks/react';

import type { TripPresence, TripStorage } from './rooms';

type LiveTripStorage = {
  itineraryVersion: number;
  notes: string;
  likedSegmentIds: LiveList<string>;
  rejectedSegmentIds: LiveList<string>;
  messages: LiveList<TripStorage['messages'][number]>;
};

export const {
  RoomProvider,
  useOthers,
  useSelf,
  useStorage,
  useMutation,
  useMyPresence,
  useUpdateMyPresence,
  useThreads,
} = createRoomContext<TripPresence, LiveTripStorage, BaseUserMeta>(
  createClient({
    authEndpoint: '/api/liveblocks-auth',
  })
);

export interface TripRoomProviderProps {
  /** Room id from `roomIdForTrip(tenantId, tripId)`. */
  roomId: string;
  initialPresence: TripPresence;
  children: ReactNode;
}

export function TripRoomProvider({ roomId, initialPresence, children }: TripRoomProviderProps) {
  return (
    <RoomProvider
      id={roomId}
      initialPresence={initialPresence}
      initialStorage={{
        itineraryVersion: 0,
        notes: '',
        likedSegmentIds: new LiveList<string>([]),
        rejectedSegmentIds: new LiveList<string>([]),
        messages: new LiveList<TripStorage['messages'][number]>([]),
      }}
    >
      {children}
    </RoomProvider>
  );
}

export type { TripPresence, TripStorage } from './rooms';
