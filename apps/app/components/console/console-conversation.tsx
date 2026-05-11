'use client';

/**
 * ConsoleConversation — Phase B-γ middle column for /dashboard/console.
 *
 * Renders the conversation column that lives between the @threads rail
 * (left) and the @stage column (right). Owns:
 *
 *   • composerMode state (internal vs channel) — derived from URL on
 *     mount, flipped via the composer footer toggle.
 *   • Optimistic outbound posts for channel mode.
 *   • Demo-trip runner (`/demo trip` slash command) — uses
 *     `getChatStatus()` from chat-bridge to poll the host's useChat
 *     status without owning the hook itself.
 *   • Liveblocks presence focus (handoff vs notes).
 *
 * Reads useChat state (messages, status, error) from Zustand — the
 * `ConsoleChatHost` mounted in the layout owns useChat and mirrors
 * those values into the store on every token. `sendViaChat()` from
 * the chat-bridge dispatches submits back to the host's `sendMessage`.
 *
 * Composer is disabled until `useSendero(s => s.hostReady)` is true so
 * the cold-load race (sibling slot mounting before the layout-level
 * host's effect runs) closes cleanly. When `sendViaChat()` returns
 * false (HMR module-state mismatch where the bridge module reloaded
 * but the Zustand flag survived), surface a toast instead of silently
 * dropping the message.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import { useRouter } from 'next/navigation';

import type { UIMessage } from 'ai';
import { useQueryState } from 'nuqs';
import type { PlanTier } from '@sendero/billing/plans';
import { toast } from '@sendero/ui/sonner';

import { sendViaChat } from '@/components/chat-bridge';
import { ChatModelTrigger } from '@/components/chat/chat-model-trigger';
import {
  TripPresenceMountFocus,
  useTripPresenceFocus,
} from '@/components/collaboration/presence-focus';
import { useSendero } from '@/components/store';
import { ChannelHeader } from '@/components/console/channel-header';
import { asChannelKey, type ChannelKey } from '@/components/console/channels';
import {
  type ComposerHandle,
  type ComposerMode,
  ConsoleComposer,
} from '@/components/console/composer';
import { ConversationStream } from '@/components/console/console-ai-elements';
import {
  DemoConversation,
  type DemoMessage,
  runDemoTripScript,
} from '@/components/console/demo-trip';
import { InjectCardDialog } from '@/components/console/inject-card-dialog';
import { UnifiedConversation } from '@/components/console/unified-conversation';
import type { UnifiedMessage } from '@/lib/unified-message';

interface ConsoleConversationProps {
  scopedTripId: string | null;
  initialConversation: UnifiedMessage[];
  traveler: { name: string; initials: string } | null;
  holdExpires: string | null;
  /** Channel kind of the focused trip (used for optimistic post + composer tinting). */
  focusedChannelKind: string | null;
  /**
   * All channel identities bound to the focused trip's traveler. Header
   * surfaces one chip per identity so dual-channel travelers (e.g. Slack
   * + WhatsApp) see both at a glance.
   */
  focusedChannels?: Array<{ kind: string; handle: string | null }>;
  /** Current org plan tier, used to keep the model picker plan-gated. */
  planTier: PlanTier;
}

export function ConsoleConversation({
  scopedTripId,
  initialConversation,
  traveler,
  holdExpires,
  focusedChannelKind,
  focusedChannels,
  planTier,
}: ConsoleConversationProps) {
  const router = useRouter();
  const [activeCs] = useQueryState('cs');

  const focusedChannel: ChannelKey = scopedTripId
    ? asChannelKey(focusedChannelKind ?? undefined)
    : 'internal';

  // Composer mode. Initial derivation matches the original
  // MetaInboxLive logic: `?cs=` wins (chat-mode click forces internal),
  // otherwise scoped trips default to channel mode and unscoped to
  // internal.
  const [composerMode, setComposerMode] = useState<ComposerMode>(
    activeCs ? 'internal' : scopedTripId ? 'channel' : 'internal'
  );
  useEffect(() => {
    setComposerMode(activeCs ? 'internal' : scopedTripId ? 'channel' : 'internal');
  }, [scopedTripId, activeCs]);

  // Demo-trip state.
  const [demoActive, setDemoActive] = useState(false);
  const [demoMessages] = useState<DemoMessage[]>([]);

  // Channel-mode optimistic posts.
  const [optimistic, setOptimistic] = useState<UnifiedMessage[]>([]);
  const [posting, setPosting] = useState(false);

  // Read host-owned chat state from Zustand. Re-renders on every
  // token (same frequency as today's MetaInboxLive — the split's win
  // is JS-execution count for sibling slots, not the conversation).
  const chatMessages = useSendero(s => s.chatMessages) as UIMessage[];
  const chatStatus = useSendero(s => s.chatStatus);
  const chatError = useSendero(s => s.chatError);
  const hostReady = useSendero(s => s.hostReady);

  const composerRef = useRef<ComposerHandle | null>(null);

  const focusHandoff = useTripPresenceFocus({ section: 'handoff', label: 'support handoff' });
  const focusNotes = useTripPresenceFocus({ section: 'notes', label: 'private trip notes' });

  const scopedConversation = useMemo<UnifiedMessage[]>(
    () => [...initialConversation, ...optimistic],
    [initialConversation, optimistic]
  );

  const isTrip = Boolean(scopedTripId);
  const isStreaming = chatStatus === 'streaming' || chatStatus === 'submitted';

  const handleSubmit = async (text: string) => {
    // /demo trip — autonomous customer↔agent script. Drives sendViaChat
    // through a queue of customer prompts; polls getChatStatus from
    // the bridge so the runner pauses between turns.
    const trimmed = text.trim().toLowerCase();
    if (trimmed === '/demo trip' || trimmed === '/demo_trip' || trimmed.startsWith('/demo ')) {
      setDemoActive(true);
      void runDemoTripScript({
        sendMessage: msg => {
          // demo-trip's sendMessage closure expects the AI SDK's sendMessage
          // shape. Adapt to bridge.sendViaChat which only takes text.
          if (typeof msg === 'object' && msg && 'text' in msg && typeof msg.text === 'string') {
            sendViaChat(msg.text);
          }
        },
        getStatus: () => {
          // Read live status from Zustand mirror; chatStatus is updated
          // by the host every render so this is fresh.
          return useSendero.getState().chatStatus;
        },
        onProgress: (current, total) => console.log(`[demo-trip] turn ${current}/${total}`),
      })
        .catch(err => console.error('[demo-trip] script error:', err))
        .finally(() => setDemoActive(false));
      return;
    }

    // Internal turns route through the bridge → host's useChat.
    if (composerMode === 'internal') {
      focusNotes();
      const ok = sendViaChat(text);
      if (!ok) {
        // Bridge not registered — host hasn't mounted, or HMR replaced
        // the bridge module while Zustand state survived. Surface to
        // the user instead of silently dropping (Codex outside-voice #2).
        toast.error('Chat unavailable — please refresh the page.');
      }
      return;
    }

    // Channel mode — POST directly to /api/inbox/<id>/reply. Does NOT
    // use the chat-bridge / useChat at all (that's why @conversation
    // doesn't need extra bridge surface for this path).
    if (!scopedTripId) return;
    focusHandoff();
    const id = `optim_${Date.now().toString(36)}`;
    const optimisticChannel: ChannelKey = focusedChannel === 'internal' ? 'web' : focusedChannel;
    setOptimistic(o => [
      ...o,
      {
        id,
        at: new Date().toISOString(),
        channel: optimisticChannel,
        direction: 'outbound',
        kind: 'message',
        author: { kind: 'operator', displayName: 'you' },
        body: text,
        status: 'pending',
      },
    ]);
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
        router.refresh();
        setOptimistic([]);
      } else {
        toast.error(`Channel reply failed (${res.status}). Try again.`);
      }
    } catch (err) {
      toast.error('Channel reply failed — network error.');
      console.error('[console-conversation] channel reply error:', err);
    } finally {
      setPosting(false);
    }
  };

  // Disabled until the layout-level host's effect has registered with
  // the chat-bridge. Codex outside-voice #1 / #2: gate is a real
  // lifecycle-bound flag, not a one-way boolean.
  const composerDisabled = posting || isStreaming || !hostReady;

  return (
    <div
      className="meta-inbox-conversation"
      style={{
        padding: '8px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        minHeight: 0,
        flex: 1,
        overflow: 'hidden',
      }}
    >
      {scopedTripId ? (
        <TripPresenceMountFocus
          section={composerMode === 'internal' ? 'notes' : 'handoff'}
          label={composerMode === 'internal' ? 'private trip notes' : 'support handoff'}
        />
      ) : null}

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <ChannelHeader
            channel={focusedChannel}
            channels={isTrip ? focusedChannels : undefined}
            traveler={isTrip ? (traveler?.name ?? undefined) : undefined}
            tripId={isTrip ? (scopedTripId ?? undefined) : undefined}
            hold={isTrip ? holdExpires : null}
          />
        </div>
        <div style={{ flexShrink: 0 }}>
          <ChatModelTrigger tier={planTier} />
        </div>
      </div>

      <div
        style={{
          flex: 1,
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          paddingRight: 4,
        }}
      >
        {composerMode === 'internal' ? (
          <>
            {demoActive ? (
              <DemoConversation
                messages={demoMessages}
                onReset={() => {
                  setDemoActive(false);
                  useSendero.getState().resetBooking();
                  useSendero.getState().clearLog();
                }}
              />
            ) : null}
            <ConversationStream
              messages={chatMessages}
              status={chatStatus}
              error={chatError}
              onStop={undefined}
            />
          </>
        ) : (
          <UnifiedConversation
            messages={scopedConversation}
            isTrip={isTrip}
            travelerInitials={traveler?.initials}
          />
        )}
      </div>

      {scopedTripId && composerMode === 'channel' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <InjectCardDialog tripId={scopedTripId} onInjected={() => router.refresh()} />
        </div>
      ) : null}

      <ConsoleComposer
        ref={composerRef}
        mode={isTrip ? composerMode : 'internal'}
        tripChannel={focusedChannel}
        onModeChange={setComposerMode}
        suggestions={
          (isTrip ? composerMode : 'internal') === 'internal'
            ? isTrip
              ? [
                  `/policy ${traveler?.name?.split(' ')[0] ?? ''}`,
                  '/spend trip',
                  `@${scopedTripId} status`,
                ]
              : ['/spend last 30d', '/demo trip', '@trp-3392 status']
            : ['Hold confirmed', 'Need traveler approval', 'Send invoice']
        }
        disabled={composerDisabled}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
