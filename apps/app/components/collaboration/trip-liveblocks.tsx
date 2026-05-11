'use client';

import { useEffect, useMemo, useRef } from 'react';

import { usePathname } from 'next/navigation';

import {
  type TripPresence,
  TripRoomProvider,
  useMyPresence,
  useOthers,
} from '@sendero/collaboration/client';
import { cn } from '@sendero/ui/cn';

import { TripPresenceFocusProvider } from './presence-focus';

type TripLiveblocksProps = {
  roomId: string;
  tripId: string;
  initialPresence: TripPresence;
  children: React.ReactNode;
};

export function TripLiveblocks({ roomId, tripId, initialPresence, children }: TripLiveblocksProps) {
  return (
    <TripRoomProvider roomId={roomId} initialPresence={initialPresence}>
      <TripPresenceFocusProvider>
        <TripPresenceTracker tripId={tripId} />
        <TripCollaborators />
        {children}
      </TripPresenceFocusProvider>
    </TripRoomProvider>
  );
}

function TripPresenceTracker({ tripId }: { tripId: string }) {
  const pathname = usePathname() ?? '';
  const [, updateMyPresence] = useMyPresence();
  const lastSent = useRef(0);
  const defaultFocus = useMemo(() => focusForPath(pathname), [pathname]);

  useEffect(() => {
    updateMyPresence({
      tripId,
      focusedSection: defaultFocus.section,
      focusLabel: defaultFocus.label,
    });
  }, [defaultFocus.label, defaultFocus.section, tripId, updateMyPresence]);

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      const now = performance.now();
      if (now - lastSent.current < 40) return;
      lastSent.current = now;
      updateMyPresence({
        cursorX: event.clientX,
        cursorY: event.clientY,
        tripId,
        focusedSection: defaultFocus.section,
        focusLabel: defaultFocus.label,
      });
    }

    function handlePointerLeave() {
      updateMyPresence({ cursorX: null, cursorY: null });
    }

    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('pointerleave', handlePointerLeave);
    window.addEventListener('blur', handlePointerLeave);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerleave', handlePointerLeave);
      window.removeEventListener('blur', handlePointerLeave);
    };
  }, [defaultFocus.label, defaultFocus.section, tripId, updateMyPresence]);

  return null;
}

function TripCollaborators() {
  const others = useOthers();
  const collaborators = others
    .filter(other => other.presence?.displayName)
    .slice(0, 6)
    .map(other => ({
      id: other.id,
      name: other.presence.displayName,
      avatarUrl: other.presence.avatarUrl,
      role: other.presence.role,
      focus: other.presence.focusLabel ?? labelForFocus(other.presence.focusedSection),
      color: colorForUser(other.id),
    }));

  if (collaborators.length === 0) return null;

  return (
    <aside
      className="pointer-events-auto fixed right-4 bottom-4 z-[65] hidden w-[280px] rounded-lg border bg-background/95 p-3 shadow-xl backdrop-blur md:block"
      style={{ borderColor: 'var(--hairline-color)' }}
      aria-label="Trip collaborators"
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="t-meta" style={{ fontSize: 10 }}>
          Trip collaborators
        </div>
        <div className="t-mono ink-60" style={{ fontSize: 10 }}>
          {collaborators.length} live
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {collaborators.map(user => (
          <div key={user.id} className="flex min-w-0 items-center gap-2">
            <div
              className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-full border bg-background text-[11px] font-semibold"
              style={{ borderColor: user.color }}
              role="img"
              aria-label={`${user.name}, ${roleLabel(user.role)} collaborator`}
            >
              {user.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                initials(user.name)
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px] font-medium text-foreground">{user.name}</div>
              <div className="truncate t-mono ink-60" style={{ fontSize: 10 }}>
                {roleLabel(user.role)} · {user.focus}
              </div>
            </div>
            <span
              className={cn('size-2 shrink-0 rounded-full')}
              style={{ backgroundColor: user.color }}
              aria-hidden="true"
            />
          </div>
        ))}
      </div>
    </aside>
  );
}

function focusForPath(pathname: string): {
  section: TripPresence['focusedSection'];
  label: string;
} {
  if (pathname.includes('/dashboard/inbox/')) {
    return { section: 'handoff', label: 'support handoff' };
  }
  return { section: 'bookings', label: 'trip workspace' };
}

function labelForFocus(section: TripPresence['focusedSection']): string {
  switch (section) {
    case 'quotes':
      return 'reviewing quotes';
    case 'handoff':
      return 'support handoff';
    case 'escrow':
      return 'escrow review';
    case 'bookings':
      return 'booking state';
    case 'notes':
      return 'trip notes';
    case 'inbox':
      return 'trip inbox';
    case 'flights':
      return 'flight options';
    case 'hotels':
      return 'stay options';
    case 'ground':
      return 'ground transport';
    default:
      return 'trip workspace';
  }
}

function roleLabel(role: TripPresence['role']): string {
  if (role === 'admin') return 'admin';
  if (role === 'finance') return 'finance';
  if (role === 'agent') return 'agent';
  if (role === 'approver') return 'approver';
  if (role === 'traveler') return 'traveler';
  return 'operator';
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join('');
}

function colorForUser(id: string | undefined): string {
  const palette = ['#cc4b37', '#1f7a69', '#7c5c2e', '#375a9e', '#9a3f72', '#5c6f2f'];
  const value = id ?? '';
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length];
}
