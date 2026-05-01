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

type WorkspaceLiveblocksProps = {
  roomId: string;
  initialPresence: TripPresence;
  children: React.ReactNode;
};

export function WorkspaceLiveblocks({
  roomId,
  initialPresence,
  children,
}: WorkspaceLiveblocksProps) {
  return (
    <TripRoomProvider roomId={roomId} initialPresence={initialPresence}>
      <PresenceTracker />
      <TeamPresence />
      {children}
    </TripRoomProvider>
  );
}

function PresenceTracker() {
  const pathname = usePathname() ?? '';
  const [, updateMyPresence] = useMyPresence();
  const lastSent = useRef(0);
  const focusedSection = useMemo(() => sectionForPath(pathname), [pathname]);

  useEffect(() => {
    updateMyPresence({ focusedSection });
  }, [focusedSection, updateMyPresence]);

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      const now = performance.now();
      if (now - lastSent.current < 33) return;
      lastSent.current = now;
      updateMyPresence({
        cursorX: event.clientX,
        cursorY: event.clientY,
        focusedSection,
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
  }, [focusedSection, updateMyPresence]);

  return null;
}

function TeamPresence() {
  const others = useOthers();
  const visibleOthers = others
    .filter(other => other.presence?.displayName)
    .slice(0, 8)
    .map(other => ({
      id: other.id,
      name: other.presence.displayName,
      avatarUrl: other.presence.avatarUrl,
      role: other.presence.role,
      cursorX: other.presence.cursorX,
      cursorY: other.presence.cursorY,
      color: colorForUser(other.id),
    }));

  if (visibleOthers.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[70]">
      {visibleOthers.map(user =>
        typeof user.cursorX === 'number' && typeof user.cursorY === 'number' ? (
          <RemoteCursor
            key={`cursor-${user.id}`}
            x={user.cursorX}
            y={user.cursorY}
            name={user.name}
            color={user.color}
          />
        ) : null
      )}
      <div className="absolute top-3 right-4 flex items-center">
        {visibleOthers.map((user, index) => (
          <div
            key={user.id}
            className={cn(
              'relative grid size-8 place-items-center overflow-hidden rounded-full border-2 bg-background text-[11px] font-semibold shadow-sm',
              index > 0 && '-ml-2'
            )}
            style={{ borderColor: user.color }}
            title={`${user.name} · ${user.role}`}
            role="img"
            aria-label={`${user.name}, ${roleLabel(user.role)} collaborator`}
          >
            {user.avatarUrl ? (
              <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <span>{initials(user.name)}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function RemoteCursor({
  x,
  y,
  name,
  color,
}: {
  x: number;
  y: number;
  name: string;
  color: string;
}) {
  return (
    <div
      className="absolute transition-transform duration-75 ease-out"
      style={{ transform: `translate3d(${x}px, ${y}px, 0)` }}
    >
      <svg
        width="18"
        height="22"
        viewBox="0 0 18 22"
        fill="none"
        aria-hidden="true"
        className="drop-shadow-sm"
      >
        <path
          d="M2 2.5 15.5 10 9.2 11.4 6.3 19.5 2 2.5Z"
          fill={color}
          stroke="white"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      </svg>
      <div
        className="ml-3 -mt-1 max-w-36 truncate rounded px-2 py-1 text-[11px] font-medium text-white shadow-sm"
        style={{ backgroundColor: color }}
      >
        {name}
      </div>
    </div>
  );
}

function sectionForPath(pathname: string): TripPresence['focusedSection'] {
  if (pathname.startsWith('/dashboard/inbox')) return 'inbox';
  if (pathname.startsWith('/dashboard/trips')) return 'trips';
  if (pathname.startsWith('/dashboard/billing') || pathname.startsWith('/dashboard/finance')) {
    return 'billing';
  }
  if (pathname.startsWith('/dashboard/settings')) return 'settings';
  return 'workspace';
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join('');
}

function roleLabel(role: TripPresence['role']): string {
  if (role === 'admin') return 'admin';
  if (role === 'finance') return 'finance';
  if (role === 'agent') return 'agent';
  if (role === 'approver') return 'approver';
  if (role === 'traveler') return 'traveler';
  return 'operator';
}

function colorForUser(id: string): string {
  const palette = ['#cc4b37', '#1f7a69', '#7c5c2e', '#375a9e', '#9a3f72', '#5c6f2f'];
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length];
}
