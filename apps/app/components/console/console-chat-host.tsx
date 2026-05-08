'use client';

/**
 * ConsoleChatHost — Phase B-γ headless layout-level host.
 *
 * The console route's parallel-routes layout mounts ONE of these so it
 * survives `?tripId` / `?cs` flips without remounting. Owns:
 *
 *   • useChat({ transport })  — single source of truth for the agent
 *     conversation. Transport rebuilds when scopedTripId / chatSessionId /
 *     chatModel change, but the host's React identity stays stable.
 *   • useChatStoreSync(messages)  — pumps tool calls into useSendero so
 *     Stage (in @stage) and WorkflowLog (also in @stage) tick live.
 *   • Zustand mirror — pushes useChat's `messages` / `status` / `error`
 *     into the store on every render so @conversation can render the
 *     AI Elements stream without owning useChat itself.
 *   • chat-bridge registration with effect-scoped cleanup — sets
 *     `hostReady` true in the same effect that registers, false in the
 *     cleanup. Codex outside-voice #1: lifecycle-bound, NOT a one-way
 *     boolean.
 *   • Resume effect (?cs=<id>) — fetches /api/chats/<id> and seeds
 *     useChat. Cancellation guard preserved per Codex #5.
 *   • EventSource on /api/inbox/<tripId>/events/stream — closes on
 *     tripId change OR unmount per Codex #6.
 *
 * Renders nothing (returns null). All UI lives in sibling slots.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import { useRouter } from 'next/navigation';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { useQueryState } from 'nuqs';

import {
  registerChatBridge,
  registerChatNote,
  registerChatStatus,
  unregisterChatBridge,
  unregisterChatNote,
  unregisterChatStatus,
} from '@/components/chat-bridge';
import { useSendero } from '@/components/store';
import { useChatStoreSync } from '@/components/use-chat-store-sync';
import { useChatModel } from '@/hooks/use-chat-model';

const SURFACE_KEY = 'console';

export function ConsoleChatHost() {
  const router = useRouter();
  const [activeCs, setActiveCs] = useQueryState('cs');
  const [scopedTripId] = useQueryState('tripId');

  // freshSessionId is minted ONCE per host mount. Used when no `?cs=`
  // is present so a brand-new conversation gets its own ChatSession
  // row on first turn. Hidden behind nuqs-shallow so subsequent ?cs=
  // navigations don't reset it.
  const [freshSessionId] = useState(
    () => `cs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
  );
  const chatSessionId = activeCs ?? freshSessionId;

  const [chatModel] = useChatModel();

  // Memoize the transport so re-renders don't reset useChat state.
  // Transport rebuilds when the trip scope, chat session, or model
  // changes — that's expected; useChat's messages array survives.
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

  const { messages, sendMessage, setMessages, status, error } = useChat({
    transport,
    onError: err => {
      console.error('[console-chat-host] useChat onError:', err);
    },
    onFinish: ({ message }) => {
      // Promote freshly-minted chatSessionId into the URL so reload /
      // shared-link lands on `?cs=<id>` and the resume effect re-
      // hydrates this exact session. Idempotent — skipped when
      // activeCs already set.
      if (!activeCs) {
        void setActiveCs(chatSessionId);
      }
      // Cross-tab + intra-tab notification for the chat-mode rail in
      // @threads to refetch immediately.
      if (typeof BroadcastChannel !== 'undefined') {
        try {
          const bc = new BroadcastChannel('sendero.chat-session.updated');
          bc.postMessage({ chatSessionId, at: new Date().toISOString() });
          bc.close();
        } catch {
          /* unsupported — SSE picks it up */
        }
      }
      // Diagnostic to keep parity with the prior MetaInboxLive log.
      console.log(
        '[console-chat-host] useChat onFinish:',
        message.id,
        'parts=',
        message.parts?.length ?? 0
      );
    },
  });

  // Mirror messages / status / error into Zustand so @conversation
  // can render without owning useChat itself.
  const setChatMessages = useSendero(s => s.setChatMessages);
  const setChatStatus = useSendero(s => s.setChatStatus);
  const setChatError = useSendero(s => s.setChatError);
  useEffect(() => {
    setChatMessages(messages);
  }, [messages, setChatMessages]);
  useEffect(() => {
    setChatStatus(status);
  }, [status, setChatStatus]);
  useEffect(() => {
    setChatError(error ? { message: String(error.message ?? error) } : null);
  }, [error, setChatError]);

  // Mirror status into a ref so the demo-trip runner can poll without
  // subscribing. Exposed via the chat-bridge `getChatStatus()` getter.
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // Pump tool calls into the SenderoApp store so Stage and WorkflowLog
  // (both in @stage slot) tick live as the agent runs.
  useChatStoreSync(messages);

  // Diagnostic — status + message count for at-a-glance debugging.
  useEffect(() => {
    console.log(
      '[console-chat-host] status:',
      status,
      'messages:',
      Array.isArray(messages) ? messages.length : 0
    );
  }, [status, messages]);

  // Bridge registration — effect-scoped with cleanup. Codex #1: same
  // effect that registers MUST also flip `hostReady`. Cleanup runs
  // unregister + flips false, so StrictMode dev double-mount doesn't
  // leave the bridge registered to a defunct closure.
  const setHostReady = useSendero(s => s.setHostReady);
  useEffect(() => {
    registerChatBridge((text: string) => sendMessage({ text }), SURFACE_KEY);
    registerChatNote((text: string) => {
      setMessages(prev => [
        ...prev,
        {
          id: `sys_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
          role: 'system' as const,
          parts: [{ type: 'text' as const, text }],
        },
      ]);
    }, SURFACE_KEY);
    registerChatStatus(() => statusRef.current, SURFACE_KEY);
    setHostReady(true);

    return () => {
      unregisterChatBridge(SURFACE_KEY);
      unregisterChatNote(SURFACE_KEY);
      unregisterChatStatus(SURFACE_KEY);
      setHostReady(false);
    };
    // sendMessage / setMessages are reference-stable across useChat's
    // transport rebuilds; binding them via the wrapper closure is
    // safe and avoids re-running this effect on every transport flip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setHostReady]);

  // Resume effect — pulls /api/chats/<id> when ?cs=<id> lands and is
  // not the freshSessionId we just minted. Cancellation guard via a
  // local boolean (Codex #5). setMessages([]) when the param clears so
  // the composer hands off cleanly to a fresh conversation.
  useEffect(() => {
    if (!activeCs) {
      setMessages([]);
      return;
    }
    if (activeCs === freshSessionId) return;
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(`/api/chats/${encodeURIComponent(activeCs)}`, {
          cache: 'no-store',
        });
        if (!r.ok) {
          console.warn('[console-chat-host] resume fetch non-ok:', r.status);
          return;
        }
        const json = (await r.json()) as { ok: boolean; messages?: UIMessage[] };
        if (cancelled) return;
        if (json.ok && Array.isArray(json.messages)) {
          setMessages(json.messages);
        }
      } catch (err) {
        console.warn('[console-chat-host] resume fetch failed', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeCs, freshSessionId, setMessages]);

  // EventSource for trip-scoped events (operator inbox replies, rich-
  // card injects, dispatcher fanouts). Closes on tripId change AND on
  // unmount (Codex #6). EventSource auto-reconnects across the 4-min
  // SSE deadline; manual cleanup only handles tripId pivots.
  useEffect(() => {
    if (!scopedTripId) return;
    let es: EventSource | null = null;
    try {
      es = new EventSource(`/api/inbox/${encodeURIComponent(scopedTripId)}/events/stream`);
    } catch (err) {
      console.warn('[console-chat-host] EventSource open failed', err);
      return;
    }
    es.addEventListener('trip_event', () => {
      router.refresh();
    });
    es.addEventListener('error', () => {
      if (es && es.readyState === EventSource.CLOSED) {
        console.warn('[console-chat-host] trip events stream closed — relying on manual refresh');
      }
    });
    return () => {
      es?.close();
    };
  }, [scopedTripId, router]);

  return null;
}
