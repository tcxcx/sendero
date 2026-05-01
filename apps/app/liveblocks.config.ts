declare global {
  interface Liveblocks {
    Presence: {
      cursor?: { x: number; y: number } | null;
      cursorX?: number | null;
      cursorY?: number | null;
      status?: 'idle' | 'reviewing' | 'thinking' | 'acting' | 'blocked';
      focusedField?: string;
      focusedSection?:
        | 'workspace'
        | 'inbox'
        | 'trips'
        | 'quotes'
        | 'handoff'
        | 'escrow'
        | 'bookings'
        | 'billing'
        | 'settings'
        | 'flights'
        | 'hotels'
        | 'ground'
        | 'notes'
        | null;
      focusLabel?: string | null;
      runStep?: string;
      tripId?: string | null;
    };

    UserMeta: {
      id: string;
      info: {
        name: string;
        avatar?: string;
        color?: string;
        role: 'traveler' | 'operator' | 'admin' | 'finance' | 'agent' | 'custom';
        teamId: string;
        kind: 'human' | 'agent';
      };
    };

    RoomInfo: {
      name: string;
      url: string;
      kind: 'team' | 'trip' | 'run' | 'reservation' | 'support' | 'custom';
      status?: string;
      channels?: string[];
      channelContexts?: {
        source: 'app' | 'slack' | 'whatsapp' | 'email' | 'support_agent' | string;
        externalId?: string;
        url?: string;
        mirrored?: boolean;
      }[];
    };

    GroupInfo: {
      name: string;
      avatar?: string;
      description?: string;
    };

    ThreadMetadata: {
      kind: 'trip_note' | 'safety_review' | 'reservation' | 'handoff' | 'support' | 'custom';
      teamId?: string;
      tripId?: string;
      runId?: string;
      reservationId?: string;
      caseId?: string;
      priority?: 'low' | 'normal' | 'high' | 'urgent';
      status?: 'open' | 'blocked' | 'resolved';
    };

    CommentMetadata: {
      source?: 'human' | 'agent' | 'system';
      toolName?: string;
      runStep?: string;
      blobUrls?: string[];
    };

    FeedMetadata: {
      kind: 'agent_run' | 'handoff' | 'reservation' | 'support' | 'digest' | 'custom';
      name: string;
      agentId?: string;
      runId?: string;
      tripId?: string;
      reservationId?: string;
      caseId?: string;
      status?: string;
      channel?: 'app' | 'slack' | 'whatsapp' | 'email' | 'support_agent' | string;
    };

    FeedMessageData: {
      role: 'user' | 'assistant' | 'system' | 'tool' | 'operator';
      content: string;
      status?: 'queued' | 'running' | 'needs_review' | 'done' | 'failed';
      toolName?: string;
      blobUrls?: string[];
      data?: Record<string, unknown>;
    };

    ActivitiesData: {
      $runUpdate: {
        title: string;
        message: string;
        status: string;
        url: string;
      };
      $handoffRequired: {
        title: string;
        message: string;
        provider: string;
        url: string;
      };
      $digestReady: {
        title: string;
        message: string;
        url: string;
      };
    };
  }
}

export {};
