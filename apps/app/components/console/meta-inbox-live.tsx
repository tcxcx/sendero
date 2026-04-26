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

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { Maximize2, Minimize2 } from 'lucide-react';
import { useQueryState } from 'nuqs';

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
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useChatStoreSync } from '@/components/use-chat-store-sync';
import { useSendero } from '@/components/store';

import { asChannelKey, type ChannelKey } from './channels';
import { DemoConversation, type DemoMessage, runDemoTripScript } from './demo-trip';
import { type ComposerMode, type ConversationEntry, MetaInbox } from './meta-inbox';
import type { TripRowData } from './trip-rail';

interface MetaInboxLiveProps {
  trips: TripRowData[];
  scopedTripId: string | null;
  initialConversation: ConversationEntry[];
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
  // Operator can pop the SENDERO AI conversation into a full-screen dialog
  // (same component, same useChat instance, just a wider canvas).
  const [expanded, setExpanded] = useState(false);

  // Scripted "demo trip" — autonomous customer↔agent simulation. Activated
  // by typing `/demo trip` in the SENDERO AI composer. See demo-trip.tsx
  // for the full script + WhatsApp-style rendering.
  const [demoActive, setDemoActive] = useState(false);
  const [demoMessages, setDemoMessages] = useState<DemoMessage[]>([]);

  // If the route changes scope, reset the default sensibly.
  useEffect(() => {
    setComposerMode(scopedTripId ? 'channel' : 'internal');
  }, [scopedTripId]);

  // Stable client-side chat session id. Generated once per
  // MetaInboxLive mount and threaded into /api/chat so the server
  // upserts a `ChatSession` row + appends every UIMessage as a
  // `ChatMessage`. Lets the CHAT MODE tab list past sessions and
  // re-view them later.
  //
  // When the URL carries `?cs=<id>` (operator clicked a row in the
  // CHAT MODE rail), we adopt that id instead so subsequent sends
  // append to the same session. Falls back to a fresh id otherwise.
  const [activeCs] = useQueryState('cs');
  const [freshSessionId] = useState(
    () => `cs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
  );
  const chatSessionId = activeCs ?? freshSessionId;

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
        }),
      }),
    [scopedTripId, chatSessionId]
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

  // Mirror status into a ref so the demo-trip runner can poll the
  // current value without subscribing to re-renders.
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // Resume past chats. When `?cs=<id>` flips (rail row click), fetch
  // that session's full UIMessage[] and seed useChat's state so the
  // conversation rehydrates inline — no page reload, no overlay flash.
  // Cleared back to [] when the operator returns to a fresh session.
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
        if (!r.ok) return;
        const json = (await r.json()) as { ok: boolean; messages?: UIMessage[] };
        if (cancelled) return;
        if (json.ok && Array.isArray(json.messages)) setMessages(json.messages);
      } catch (err) {
        console.warn('[meta-inbox-live] resume fetch failed', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeCs, setMessages]);

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
  const [optimistic, setOptimistic] = useState<ConversationEntry[]>([]);
  const [posting, setPosting] = useState(false);

  const scopedConversation = useMemo<ConversationEntry[]>(
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
  // The same body renders in two contexts: the narrow inline column
  // (380px in MetaInbox.cols) and a full-screen dialog the operator
  // toggles via the expand button on the SENDERO AI header.
  const renderHeader = (variant: 'inline' | 'dialog') => (
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
            </div>
          </div>
        ) : (
          messages.map(m => (
            <Message key={m.id} from={m.role}>
              <UIMessageBody message={m} />
            </Message>
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

  // Inline slot — collapses to nothing when expanded so the conversation
  // doesn't render twice (avoids two stick-to-bottom contexts fighting).
  const conversationSlot =
    composerMode === 'internal' ? (
      expanded ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            height: '100%',
            color: 'var(--text-dim)',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
          }}
        >
          <span>Sendero AI · expanded</span>
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="sd-pill sd-pill-outline"
            style={{ padding: '6px 12px', fontSize: 11 }}
          >
            ↩ Collapse
          </button>
        </div>
      ) : (
        <>
          {demoBanner}
          {renderHeader('inline')}
          {conversationBody}
        </>
      )
    ) : undefined;

  return (
    <>
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

      {/* Full-screen Sendero AI conversation. Shares the same useChat
          state — sending from either canvas hits the same backend. */}
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent
          className="flex flex-col gap-3 p-6"
          style={{
            width: 'min(100vw, 1280px)',
            maxWidth: 'calc(100vw - 48px)',
            height: 'calc(100vh - 64px)',
            maxHeight: 'calc(100vh - 64px)',
            background: 'var(--surface-base, #fdfbf7)',
            borderRadius: 12,
            overflow: 'hidden',
          }}
        >
          {/* Visually-hidden DialogTitle keeps Radix's a11y contract
              (screen readers announce the dialog name); the visible
              header below replaces it for sighted users. */}
          <DialogTitle className="sr-only">Sendero AI conversation</DialogTitle>
          {renderHeader('dialog')}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              overflow: 'hidden',
            }}
          >
            {conversationBody}
          </div>
          {/* Composer is in the parent app shell. The dialog is a wider
              read+monitor canvas; sending still happens from the inbox
              composer below. We could mount a duplicate composer here
              later, but two composers wired to the same useChat would
              just race for the same input string. */}
        </DialogContent>
      </Dialog>
    </>
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
    <MessageContent>
      {parts.map((part, i) => {
        const key = `${message.id}-${i}`;
        const t = part.type ?? '';

        if (t === 'text' && typeof part.text === 'string' && part.text.length > 0) {
          return <MessageResponse key={key}>{part.text}</MessageResponse>;
        }

        if (t === 'reasoning' && typeof part.text === 'string' && part.text.length > 0) {
          return (
            <Reasoning key={key} className="w-full">
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
            <Tool key={key}>
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
