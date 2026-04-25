'use client';

/**
 * MetaInboxLive — client wrapper around MetaInbox that wires the
 * composer to real APIs.
 *
 *   - Internal mode (no scopedTripId): @ai-sdk/react's `useChat` pointed
 *     at /api/chat. The agent reply streams back. Messages are mapped
 *     into ConversationEntry shape so MetaInbox can render them as
 *     op/ai/tool bubbles.
 *
 *   - Scoped mode (scopedTripId): operator reply posts to
 *     /api/inbox/[tripId]/reply, optimistically appends the message
 *     to the rendered conversation, then router.refresh()'s so the
 *     server-side event log is the source of truth on the next render.
 *
 * The conversation prop from the page is treated as the initial
 * server-rendered baseline; live messages stack on top.
 */

import { useMemo, useState } from 'react';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { useRouter } from 'next/navigation';

import { asChannelKey, type ChannelKey } from './channels';
import { type ConversationEntry, MetaInbox } from './meta-inbox';
import type { TripRowData } from './trip-rail';

interface MetaInboxLiveProps {
  trips: TripRowData[];
  scopedTripId: string | null;
  initialConversation: ConversationEntry[];
  traveler?: { name: string; initials: string } | null;
  holdExpires?: string | null;
}

export function MetaInboxLive({
  trips,
  scopedTripId,
  initialConversation,
  traveler,
  holdExpires,
}: MetaInboxLiveProps) {
  const router = useRouter();
  const isInternal = !scopedTripId;

  // Resolve the focused trip's channel for scoped mode.
  const focusedChannel: ChannelKey = scopedTripId
    ? asChannelKey(trips.find(t => t.id === scopedTripId)?.channel)
    : 'internal';

  // Internal mode: live agent stream.
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
  });

  // Scoped mode: optimistic operator messages awaiting the next refresh.
  const [optimistic, setOptimistic] = useState<ConversationEntry[]>([]);
  const [posting, setPosting] = useState(false);

  const conversation = useMemo<ConversationEntry[]>(() => {
    if (isInternal) {
      const live = aiMessagesToEntries(messages);
      // Hide the seed system intro once the operator starts a real turn.
      return live.length > 0 ? live : initialConversation;
    }
    return [...initialConversation, ...optimistic];
  }, [isInternal, messages, initialConversation, optimistic]);

  const handleSubmit = async (text: string) => {
    if (isInternal) {
      sendMessage({ text });
      return;
    }
    if (!scopedTripId) return;
    const id = `optim_${Date.now().toString(36)}`;
    const stamp = new Date().toTimeString().slice(0, 5);
    setOptimistic(o => [...o, { id, role: 'op', body: text, t: stamp }]);
    setPosting(true);
    try {
      const res = await fetch(`/api/inbox/${scopedTripId}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: focusedChannel === 'internal' ? 'web' : focusedChannel,
          isInternal: false,
          text,
        }),
      });
      if (res.ok) {
        // Server now has the canonical event; refetch the page so the
        // server-rendered conversation absorbs the optimistic entry.
        router.refresh();
        setOptimistic([]);
      }
    } finally {
      setPosting(false);
    }
  };

  const isStreaming = status === 'streaming' || status === 'submitted';

  return (
    <MetaInbox
      trips={trips}
      scopedTripId={scopedTripId}
      conversation={conversation}
      traveler={traveler}
      holdExpires={holdExpires}
      onSubmit={handleSubmit}
      disabled={posting || isStreaming}
    />
  );
}

// ── useChat → ConversationEntry mapping ────────────────────────

interface ToolPart {
  type: string;
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  state?: string;
}

function aiMessagesToEntries(messages: UIMessage[]): ConversationEntry[] {
  const out: ConversationEntry[] = [];
  for (const m of messages) {
    const role: ConversationEntry['role'] = m.role === 'user' ? 'op' : 'ai';
    const parts = (m.parts ?? []) as Array<{ type: string; text?: string } & ToolPart>;
    for (const part of parts) {
      if (part.type === 'text' && typeof part.text === 'string' && part.text.length > 0) {
        out.push({
          id: `${m.id}_text_${out.length}`,
          role,
          body: part.text,
        });
        continue;
      }
      if (typeof part.type === 'string' && part.type.startsWith('tool-')) {
        const toolName = part.toolName ?? part.type.replace('tool-', '');
        const input = part.input;
        out.push({
          id: `${m.id}_tool_${part.toolCallId ?? out.length}`,
          role: 'tool',
          toolName,
          toolArgs:
            typeof input === 'string'
              ? input
              : input && typeof input === 'object'
                ? JSON.stringify(input).slice(0, 80)
                : undefined,
        });
      }
    }
  }
  return out;
}
