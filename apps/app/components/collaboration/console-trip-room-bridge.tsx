'use client';

/**
 * Phase C-1 — `ConsoleTripRoomBridge`.
 *
 * The /dashboard/console layout wraps its slot row in this client
 * component. When the URL has `?tripId=…`, the bridge fetches
 * `{ roomId, initialPresence }` from `/api/trip-room-bootstrap` and
 * mounts a single `<TripLiveblocks>` (which provides
 * `<TripRoomProvider>` + `<TripPresenceFocusProvider>` +
 * `<TripCollaborators>` + `<TripPresenceTracker>`) wrapping the rest
 * of the console subtree.
 *
 * When `?tripId` is unset, children render through unchanged — no
 * trip-scoped Liveblocks room, just the workspace room from
 * `dashboard/layout.tsx`'s `<WorkspaceLiveblocks>`.
 *
 *   ┌─────────────────────────────────────────────────────────┐
 *   │  ConsoleTripRoomBridge (this file)                      │
 *   │                                                          │
 *   │  ?tripId set:                                            │
 *   │    1. fetch /api/trip-room-bootstrap                     │
 *   │    2. mount <TripLiveblocks>                             │
 *   │       → all slot children share the same trip room       │
 *   │       → useTripPresenceFocus calls in ConsoleConversation│
 *   │         start firing (instead of no-op)                  │
 *   │       → @context's <TripComments> can render             │
 *   │                                                          │
 *   │  ?tripId unset:                                          │
 *   │    just render children — no trip room                   │
 *   └─────────────────────────────────────────────────────────┘
 *
 * Pattern locked in `/plan-eng-review` E1 (2026-05-08): the two-
 * RoomProviders-refcount-shared alternative was viable but had an
 * `initialPresence` first-wins gotcha; one provider in a layout
 * client bridge is canonical.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';

import type { TripPresence } from '@sendero/collaboration/client';
import { useQueryState } from 'nuqs';

import { TripLiveblocks } from '@/components/collaboration/trip-liveblocks';

interface BootstrapState {
  tripId: string;
  roomId: string;
  initialPresence: TripPresence;
}

interface BootstrapResponse {
  roomId: string;
  initialPresence: TripPresence;
  error?: string;
}

export function ConsoleTripRoomBridge({ children }: { children: ReactNode }) {
  const [tripId] = useQueryState('tripId');
  const [bootstrap, setBootstrap] = useState<BootstrapState | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  // Keep the in-flight request id so a stale response doesn't clobber
  // a fresh one (rapid trip switching). Each fetch increments; only
  // the most recent fetch's response sets state.
  const requestId = useRef(0);

  useEffect(() => {
    if (!tripId) {
      setBootstrap(null);
      setBootstrapError(null);
      return;
    }
    // If we already have bootstrap for this tripId, skip the fetch.
    if (bootstrap?.tripId === tripId) return;

    const myId = ++requestId.current;
    const controller = new AbortController();
    setBootstrapError(null);

    void (async () => {
      try {
        const r = await fetch('/api/trip-room-bootstrap', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tripId }),
          signal: controller.signal,
          cache: 'no-store',
        });
        if (myId !== requestId.current) return; // stale
        if (!r.ok) {
          const text = await r.text().catch(() => '');
          setBootstrapError(`Trip room bootstrap failed (${r.status}).`);
          console.warn(
            '[console-trip-room-bridge] bootstrap fetch non-ok:',
            r.status,
            text.slice(0, 200)
          );
          return;
        }
        const json = (await r.json()) as BootstrapResponse;
        if (myId !== requestId.current) return;
        if (!json.roomId || !json.initialPresence) {
          setBootstrapError('Trip room bootstrap returned a malformed payload.');
          console.warn('[console-trip-room-bridge] bootstrap returned malformed payload');
          return;
        }
        setBootstrap({
          tripId,
          roomId: json.roomId,
          initialPresence: json.initialPresence,
        });
      } catch (err) {
        if (myId !== requestId.current) return;
        if ((err as Error).name === 'AbortError') return;
        setBootstrapError('Trip room bootstrap failed.');
        console.warn('[console-trip-room-bridge] bootstrap fetch failed:', err);
      }
    })();

    return () => {
      controller.abort();
    };
    // bootstrap excluded from deps intentionally — the same-tripId
    // short-circuit above handles the deduplication; including it
    // would recreate the abort controller on every state change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId]);

  // No tripId → render children unchanged.
  if (!tripId) {
    return <>{children}</>;
  }

  // A scoped trip renders TripComments in the @context slot. Hold the
  // slot tree until the trip room provider is mounted, otherwise
  // Liveblocks hooks throw before the bootstrap request resolves.
  if (!bootstrap || bootstrap.tripId !== tripId) {
    return (
      <div className="flex h-full min-h-0 w-full flex-1 items-center justify-center p-6 text-xs text-[color:var(--surface-muted,#888)]">
        {bootstrapError ?? 'Connecting trip workspace...'}
      </div>
    );
  }

  return (
    <TripLiveblocks
      roomId={bootstrap.roomId}
      tripId={bootstrap.tripId}
      initialPresence={bootstrap.initialPresence}
    >
      {children}
    </TripLiveblocks>
  );
}
