'use client';

import { LiveblocksProvider, useErrorListener } from '@liveblocks/react';

type LiveblocksProjectProviderProps = {
  children: React.ReactNode;
};

export function LiveblocksProjectProvider({ children }: LiveblocksProjectProviderProps) {
  const Provider = LiveblocksProvider as React.ComponentType<
    React.ComponentProps<typeof LiveblocksProvider> & {
      resolveGroupsInfo?: (args: { groupIds: string[] }) => Promise<unknown[] | undefined>;
    }
  >;

  return (
    <Provider
      authEndpoint={async room => {
        const response = await fetch('/api/liveblocks-auth', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ room }),
        });
        const data = await response.json();
        if (response.status === 401 || response.status === 403) {
          return {
            error: 'forbidden',
            reason: typeof data?.error === 'string' ? data.error : 'liveblocks_forbidden',
          };
        }
        return data;
      }}
      preventUnsavedChanges
      resolveUsers={async ({ userIds }) => {
        const response = await fetch('/api/liveblocks-resolve', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ kind: 'users', userIds }),
        });
        if (!response.ok) return userIds.map(() => undefined);
        const data = (await response.json()) as { users?: unknown[] };
        return data.users;
      }}
      resolveRoomsInfo={async ({ roomIds }) => {
        const response = await fetch('/api/liveblocks-resolve', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ kind: 'rooms', roomIds }),
        });
        if (!response.ok) return roomIds.map(() => undefined);
        const data = (await response.json()) as { rooms?: unknown[] };
        return data.rooms;
      }}
      resolveGroupsInfo={async ({ groupIds }) => {
        const response = await fetch('/api/liveblocks-resolve', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ kind: 'groups', groupIds }),
        });
        if (!response.ok) return groupIds.map(() => undefined);
        const data = (await response.json()) as { groups?: unknown[] };
        return data.groups;
      }}
      resolveMentionSuggestions={async ({ text, roomId }) => {
        const response = await fetch('/api/liveblocks-resolve', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ kind: 'mentions', text, roomId }),
        });
        if (!response.ok) return [];
        const data = (await response.json()) as { suggestions?: string[] };
        return data.suggestions ?? [];
      }}
      lostConnectionTimeout={5000}
    >
      <LiveblocksErrorReporter />
      {children}
    </Provider>
  );
}

function LiveblocksErrorReporter() {
  useErrorListener(error => {
    console.warn('[liveblocks]', error.context.type, error.message);
  });
  return null;
}
