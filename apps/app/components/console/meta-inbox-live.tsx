'use client';

/**
 * MetaInboxLive — client wrapper around MetaInbox.
 *
 * Two modes routed by `?tripId=`:
 *
 *   - Internal (no scopedTripId): operator chats with Sendero AI via
 *     `useChat` → `/api/chat`. We render through the AI Elements stack
 *     (Conversation / Message / Tool / Reasoning / MessageResponse) —
 *     same render path the working `/dashboard/agent-chat` uses, so
 *     streaming text + tool calls + reasoning all surface live.
 *
 *   - Channel (scopedTripId set): operator messages relay to the
 *     traveler over the trip's primary channel via
 *     `/api/inbox/[tripId]/reply`. Rendered as the existing customer /
 *     operator bubbles (server log is the source of truth on refresh).
 *
 * Tool calls coming back from useChat are also pushed into the
 * workflow store (`useSendero.logEvent`) so the right-column
 * WorkflowLog ticks live as the agent runs — same component the `/`
 * shell uses.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import { useRouter } from 'next/navigation';
import { useQueryState } from 'nuqs';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { useUser } from '@clerk/nextjs';

import { useChatModel } from '@/hooks/use-chat-model';

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message';
import { Persona, type PersonaState } from '@/components/ai-elements/persona';
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning';
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from '@/components/ai-elements/tool';
import { useChatStoreSync } from '@/components/use-chat-store-sync';
import { useSendero } from '@/components/store';

import { asChannelKey, type ChannelKey } from './channels';
import { DemoConversation, type DemoMessage, runDemoTripScript } from './demo-trip';
import { type ComposerMode, MetaInbox, type UnifiedMessage } from './meta-inbox';
import type { TripRowData } from './trip-rail';

interface MetaInboxLiveProps {
  trips: TripRowData[];
  scopedTripId: string | null;
  initialConversation: UnifiedMessage[];
  traveler?: { name: string; initials: string } | null;
  holdExpires?: string | null;
  pendingBooking?: { id: string; totalUsd: string } | null;
}

export function MetaInboxLive({
  trips,
  scopedTripId,
  initialConversation,
  traveler,
  holdExpires,
  pendingBooking,
}: MetaInboxLiveProps) {
  const router = useRouter();
  const focusedChannel: ChannelKey = scopedTripId
    ? asChannelKey(trips.find(t => t.id === scopedTripId)?.channel)
    : 'internal';

  // Composer mode. Unscoped is locked to 'internal'; scoped defaults to
  // 'channel' (replies go to the traveler) but the operator can flip to
  // 'internal' to take a private aside with Sendero AI without
  // interrupting the autonomous customer conversation.
  const [composerMode, setComposerMode] = useState<ComposerMode>(
    scopedTripId ? 'channel' : 'internal'
  );

  // Scripted "demo trip" — autonomous customer↔agent simulation. Activated
  // by typing `/demo trip` in the SENDERO AI composer. See demo-trip.tsx
  // for the full script + WhatsApp-style rendering.
  const [demoActive, setDemoActive] = useState(false);
  const [demoMessages, setDemoMessages] = useState<DemoMessage[]>([]);

  // If the route changes scope, reset the default sensibly.
  useEffect(() => {
    setComposerMode(scopedTripId ? 'channel' : 'internal');
  }, [scopedTripId]);

  // Resume vs. fresh: `?cs=<id>` in the URL means the operator clicked
  // a row in the CHAT MODE rail. We use that id as the chatSessionId
  // and rehydrate setMessages from /api/chats/[id]. Without `?cs=` we
  // fall back to a freshly minted id so a brand-new conversation gets
  // its own ChatSession row on the first turn. nuqs is shallow by
  // default — switching sessions updates the URL via history.replaceState
  // with no RSC refetch and no loading.tsx overlay.
  const [activeCs] = useQueryState('cs');
  const [freshSessionId] = useState(
    () => `cs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
  );
  const chatSessionId = activeCs ?? freshSessionId;

  const [chatModel] = useChatModel();

  // Memoize the transport so re-renders don't reset useChat state.
  // The body callback closes over scopedTripId so we re-create when
  // the trip scope changes.
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/chat',
        body: () => ({
          channel: 'web' as const,
          tripId: scopedTripId ?? undefined,
          chatSessionId,
          model: chatModel,
        }),
      }),
    [scopedTripId, chatSessionId, chatModel]
  );

  // useChat drives the internal-mode AI Elements stream. It mounts
  // regardless of mode so the agent remains running in the background
  // even while the operator is typing into the channel composer.
  const { messages, sendMessage, setMessages, status, error, stop } = useChat({
    transport,
    onError: err => {
      console.error('[meta-inbox-live] useChat onError:', err);
    },
    onFinish: ({ message }) => {
      console.log(
        '[meta-inbox-live] useChat onFinish:',
        message.id,
        'parts=',
        message.parts?.length ?? 0
      );
      // Tell the CHAT MODE rail to refetch immediately. Sub-100ms in
      // the same tab — the SSE round-trip from /api/chats/stream is
      // the cross-tab fallback.
      if (typeof BroadcastChannel !== 'undefined') {
        try {
          const bc = new BroadcastChannel('sendero.chat-session.updated');
          bc.postMessage({ chatSessionId, at: new Date().toISOString() });
          bc.close();
        } catch {
          /* unsupported — SSE picks it up */
        }
      }
    },
  });

  // Resume effect: when `?cs=<id>` lands in the URL (rail click,
  // shared link, page refresh on a session view), pull the full
  // message history and seed useChat. setMessages([]) when the param
  // clears so the composer hands off to a fresh conversation cleanly.
  useEffect(() => {
    if (!activeCs) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(`/api/chats/${encodeURIComponent(activeCs)}`, {
          cache: 'no-store',
        });
        if (!r.ok) {
          console.warn('[meta-inbox-live] resume fetch non-ok:', r.status);
          return;
        }
        const json = (await r.json()) as { ok: boolean; messages?: UIMessage[] };
        if (cancelled) return;
        if (json.ok && Array.isArray(json.messages)) {
          setMessages(json.messages);
        }
      } catch (err) {
        console.warn('[meta-inbox-live] resume fetch failed', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeCs, setMessages]);

  // Mirror status into a ref so the demo-trip runner can poll the
  // current value without subscribing to re-renders.
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // Diagnostic logs — surface chat status, message count, and any
  // streaming error in the console so we can see at a glance whether
  // the agent reply is in flight, failed, or simply not arriving.
  useEffect(() => {
    console.log('[meta-inbox-live] status:', status, 'messages:', messages.length);
  }, [status, messages.length]);
  useEffect(() => {
    if (error) console.error('[meta-inbox-live] useChat error state:', error);
  }, [error]);

  // Pump every tool call into the SenderoApp store so:
  //   · Stage renders the right artifact (offer cards / hold card /
  //     hotels / settlement panel) — same flow the `/` shell does.
  //   · WorkflowLog ticks active → done with proper labels.
  //   · FooterRail balances refresh after treasury-mutating tools.
  // Shared with ChatCol via `useChatStoreSync` so behavior never
  // drifts across the two surfaces.
  useChatStoreSync(messages);

  // ── scoped (channel) mode ─────────────────────────────────────────
  const [optimistic, setOptimistic] = useState<UnifiedMessage[]>([]);
  const [posting, setPosting] = useState(false);

  const scopedConversation = useMemo<UnifiedMessage[]>(
    () => [...initialConversation, ...optimistic],
    [initialConversation, optimistic]
  );

  const handleSubmit = async (text: string) => {
    console.log('[meta-inbox-live] submit:', {
      mode: composerMode,
      scopedTripId,
      focusedChannel,
      length: text.length,
    });

    // ── /demo trip slash command — autonomous REAL-agent run ─────────
    // Drives the existing useChat → /api/agent/chat pipeline through a
    // queue of customer prompts. Real Duffel sandbox + real Arc-Testnet
    // settlement + real NFT mints. See demo-trip.tsx.
    const trimmed = text.trim().toLowerCase();
    if (trimmed === '/demo trip' || trimmed === '/demo_trip' || trimmed.startsWith('/demo ')) {
      setDemoActive(true);
      setDemoMessages([]);
      void runDemoTripScript({
        sendMessage: msg => sendMessage(msg),
        getStatus: () => statusRef.current,
        onProgress: (current, total) => console.log(`[demo-trip] turn ${current}/${total}`),
      })
        .catch(err => console.error('[demo-trip] script error:', err))
        .finally(() => setDemoActive(false));
      return;
    }

    // Internal turns always go through useChat so the AI Elements
    // stream renders the agent reply inline. Works even when scoped to
    // a trip — the message is private; only the operator sees it.
    if (composerMode === 'internal') {
      sendMessage({ text });
      return;
    }
    // Channel turns relay to the traveler over the trip's primary
    // channel. Optimistically append, fetch reply, then re-fetch the
    // canonical event log on success.
    if (!scopedTripId) return;
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
      }
    } finally {
      setPosting(false);
    }
  };

  const isStreaming = status === 'streaming' || status === 'submitted';

  // ── Persona state mapping (Rive avatar) ────────────────────────────
  // useChat status → Persona animation. The Persona mounts ONCE in
  // the sticky header above the conversation; per-message Personas
  // would each spin up a Rive WebGL2 context (~190KB + a GPU
  // context) which is wasteful. Single instance, status-driven.
  const personaState: PersonaState = (() => {
    if (status === 'submitted') return 'thinking';
    if (status === 'streaming') return 'speaking';
    if (messages.length === 0) return 'asleep';
    return 'idle';
  })();
  const personaLabel = (() => {
    if (status === 'submitted') return 'Thinking — running tools';
    if (status === 'streaming') return 'Streaming response';
    if (messages.length === 0) return 'Tap a prompt to wake the agent';
    return 'Ready';
  })();

  // ── internal-mode AI Elements slot ─────────────────────────────────
  // Render the AI Elements conversation when the active composer mode
  // is internal. In channel mode we fall back to MetaInbox's built-in
  // ConversationEntry render so the operator sees the trip log.
  const renderHeader = () => (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 4px',
        marginBottom: 6,
        flexShrink: 0,
      }}
    >
      <Persona
        className="size-14 shrink-0"
        state={personaState}
        variant="halo"
        color="var(--ink)"
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
        <div
          className="t-mono"
          style={{
            fontSize: 10,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--ink)',
            fontWeight: 600,
          }}
        >
          Sendero AI
        </div>
        <div
          className="t-mono"
          style={{
            fontSize: 11,
            color: 'var(--text-dim)',
          }}
        >
          {personaLabel}
        </div>
      </div>
    </header>
  );

  const conversationBody = (
    <Conversation className="flex-1">
      <ConversationContent>
        {messages.length === 0 ? (
          <div
            style={{
              padding: 24,
              textAlign: 'center',
              color: 'rgba(31,42,68,0.55)',
            }}
          >
            <div className="t-h2" style={{ fontSize: 22, marginBottom: 8 }}>
              Ask Sendero anything
            </div>
            <div
              className="t-body ink-70"
              style={{ fontSize: 13, maxWidth: '42ch', margin: '0 auto' }}
            >
              Run a report, change policy, or investigate a trip. None of this reaches a customer.
              Change channels to directly message your user's or let Sendero AI handle it
              automatically. Use Sendero privately to give better customer support to make trips
              delightful.
            </div>
          </div>
        ) : (
          messages.map(m => (
            <div
              key={m.id}
              className={
                'flex w-full items-start gap-3 ' + (m.role === 'user' ? 'flex-row-reverse' : '')
              }
            >
              {m.role === 'user' ? <UserMessageAvatar /> : <AgentMessageAvatar />}
              <Message from={m.role} className="!max-w-[calc(95%-44px)]">
                <UIMessageBody message={m} />
              </Message>
            </div>
          ))
        )}
        {error ? (
          <div
            role="alert"
            style={{
              margin: '8px auto',
              maxWidth: '72ch',
              padding: '10px 14px',
              background: 'rgba(199,89,77,0.08)',
              border: '1px solid var(--vermillion)',
              borderRadius: 8,
              color: 'var(--vermillion)',
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              lineHeight: 1.55,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <strong style={{ fontWeight: 600 }}>chat error:</strong>
            <span style={{ flex: 1 }}>{String(error.message ?? error)}</span>
            <button
              type="button"
              onClick={stop}
              style={{
                padding: '3px 8px',
                background: 'var(--vermillion)',
                color: '#fdfbf7',
                border: 0,
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 10,
              }}
            >
              stop
            </button>
          </div>
        ) : null}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );

  // Demo-trip slot — when /demo trip is active we replace the AI Elements
  // Demo banner sits ABOVE the AI Elements stream (does NOT replace it).
  // The real conversation keeps rendering — operator sees customer prompts,
  // agent text, tool blocks, reasoning. The banner just signals "demo run
  // in progress" + lets the operator bail out early.
  const demoBanner = demoActive ? (
    <DemoConversation
      messages={demoMessages}
      onReset={() => {
        setDemoActive(false);
        setDemoMessages([]);
        useSendero.getState().resetBooking();
        useSendero.getState().clearLog();
      }}
    />
  ) : null;

  // Inline slot — single render path for the internal-mode AI Elements
  // stream. The expand-to-fullscreen affordance was removed (it was
  // intended for react-flow diagrams, not chat); the dialog wrapper +
  // `expanded` state went with it.
  const conversationSlot =
    composerMode === 'internal' ? (
      <>
        {demoBanner}
        {renderHeader()}
        {conversationBody}
      </>
    ) : undefined;

  return (
    <MetaInbox
      trips={trips}
      scopedTripId={scopedTripId}
      conversation={scopedConversation}
      conversationSlot={conversationSlot}
      traveler={traveler}
      holdExpires={holdExpires}
      pendingBooking={pendingBooking}
      composerMode={composerMode}
      onComposerModeChange={setComposerMode}
      onSubmit={handleSubmit}
      disabled={posting || isStreaming}
    />
  );
}

// ── UIMessage → AI Elements parts ────────────────────────────────────

interface ToolPartShape {
  type?: string;
  text?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  toolCallId?: string;
  toolName?: string;
  toolInvocation?: {
    toolCallId?: string;
    toolName?: string;
    state?: string;
    input?: unknown;
    result?: unknown;
  };
}

function UIMessageBody({ message }: { message: UIMessage }) {
  const parts = (message.parts ?? []) as Array<ToolPartShape>;
  return (
    <MessageContent className="relative isolate overflow-hidden rounded-2xl border border-[color:var(--hairline-color-soft)] bg-[color:color-mix(in_oklab,var(--surface-raised)_82%,transparent)] px-4 py-3 text-[color:var(--midnight)] shadow-[inset_0_1px_0_rgba(255,255,255,0.55),inset_0_-1px_0_rgba(255,255,255,0.12),0_8px_24px_-18px_rgba(31,42,68,0.22)] backdrop-blur-[6px] backdrop-saturate-[1.4] [--bubble-tint:var(--ink)] group-[.is-user]:!rounded-2xl group-[.is-user]:!bg-[color:color-mix(in_oklab,var(--surface-raised)_82%,transparent)] group-[.is-user]:!text-[color:var(--midnight)] group-[.is-user]:[--bubble-tint:var(--midnight)]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.18]"
        style={{
          backgroundColor: 'var(--bubble-tint)',
          WebkitMaskImage: "url('/patterns/topography.svg')",
          maskImage: "url('/patterns/topography.svg')",
          WebkitMaskRepeat: 'repeat',
          maskRepeat: 'repeat',
          WebkitMaskSize: '320px 320px',
          maskSize: '320px 320px',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-[5] h-2/3 rounded-t-2xl bg-gradient-to-b from-white/35 via-white/10 to-transparent"
      />
      {parts.map((part, i) => {
        const key = `${message.id}-${i}`;
        const t = part.type ?? '';

        if (t === 'text' && typeof part.text === 'string' && part.text.length > 0) {
          return <MessageResponse key={key}>{part.text}</MessageResponse>;
        }

        if (t === 'reasoning' && typeof part.text === 'string' && part.text.length > 0) {
          // Collapsed by default — operator opens the trigger to read.
          return (
            <Reasoning key={key} className="w-full" defaultOpen={false}>
              <ReasoningTrigger />
              <ReasoningContent>{part.text}</ReasoningContent>
            </Reasoning>
          );
        }

        if (t.startsWith('tool-') || t === 'dynamic-tool') {
          const toolName =
            part.toolName ??
            part.toolInvocation?.toolName ??
            (t.startsWith('tool-') ? t.slice('tool-'.length) : 'tool');
          const state = part.state ?? part.toolInvocation?.state ?? 'input-streaming';
          const input = (part.input ?? part.toolInvocation?.input ?? {}) as Record<string, unknown>;
          const output = part.output ?? part.toolInvocation?.result;
          const aiElementState =
            state === 'output-available' || state === 'result'
              ? 'output-available'
              : state === 'output-error'
                ? 'output-error'
                : state === 'input-available'
                  ? 'input-available'
                  : 'input-streaming';
          // Tool block defaults CLOSED. While running (input-streaming
          // or input-available), the header shows the pulsing ink
          // north-star — that's the only motion the operator needs.
          // The block stays collapsed even after the result lands;
          // operators can open any tool to inspect inputs/outputs.
          return (
            <Tool
              key={key}
              className="border-[color:color-mix(in_oklab,var(--ink)_55%,transparent)] bg-[color:color-mix(in_oklab,var(--ink)_4%,var(--surface-raised))] shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_1px_2px_color-mix(in_oklab,var(--ink)_18%,transparent)]"
            >
              <ToolHeader type={`tool-${toolName}` as `tool-${string}`} state={aiElementState} />
              <ToolContent>
                <ToolInput input={input} />
                {(state === 'output-available' || state === 'result') && (
                  <ToolOutput output={output} errorText={undefined} />
                )}
                {state === 'output-error' && (
                  <ToolOutput output={undefined} errorText={part.errorText ?? 'Tool failed'} />
                )}
              </ToolContent>
            </Tool>
          );
        }

        return null;
      })}
    </MessageContent>
  );
}

// ─── Avatars ────────────────────────────────────────────────────────────
//
// User: bordered circle, ink fill, Clerk profile photo inside (or initial).
// Agent: bordered circle, white fill, shared Persona halo Rive inside.

function UserMessageAvatar() {
  const { user } = useUser();
  const initial = (user?.firstName ?? user?.username ?? 'U').slice(0, 1).toUpperCase();
  return (
    <div
      className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[color:var(--hairline-color-strong)] bg-[color:var(--ink)] text-[11px] font-semibold text-[color:#fdfbf7]"
      aria-hidden="true"
    >
      {user?.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={user.imageUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        initial
      )}
    </div>
  );
}

function AgentMessageAvatar() {
  return (
    <div
      className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[color:var(--hairline-color-strong)] bg-white"
      aria-hidden="true"
    >
      <Persona state="idle" variant="halo" className="h-7 w-7" />
    </div>
  );
}
