'use client';

/**
 * Phase B-γ — extracted AI Elements rendering shared between
 * `MetaInboxLive` (still used by /dashboard/inbox/[tripId]) and the
 * new `ConsoleConversation` (which mounts in the @conversation
 * parallel-routes slot on /dashboard/console).
 *
 * The original implementation lived inline inside MetaInboxLive
 * (lines 471-555 + 617-770). Lifting it here lets both surfaces
 * render the same conversation body without duplicating the
 * UIMessage → AI Elements parts mapping. Phase B-δ deletes the
 * MetaInboxLive copy when /dashboard/inbox/[tripId] migrates to the
 * slot architecture and the monolith goes away.
 */

import { useUser } from '@clerk/nextjs';
import type { UIMessage } from 'ai';

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

interface ConversationStreamProps {
  messages: UIMessage[];
  status: 'submitted' | 'streaming' | 'ready' | 'error' | 'unknown';
  error: { message: string } | null;
  onStop?: () => void;
}

/**
 * Top-level conversation body: header chip with persona + status,
 * scrolling message list with AI Elements parts, optional inline
 * error banner with stop button.
 */
export function ConversationStream({ messages, status, error, onStop }: ConversationStreamProps) {
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

  return (
    <>
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
                Change channels to directly message your user&rsquo;s or let Sendero AI handle it
                automatically. Use Sendero privately to give better customer support to make trips
                delightful.
              </div>
            </div>
          ) : (
            messages.map(m => (
              <div
                key={m.id}
                className={`flex w-full items-start gap-3 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}
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
              <span style={{ flex: 1 }}>{error.message}</span>
              {onStop ? (
                <button
                  type="button"
                  onClick={onStop}
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
              ) : null}
            </div>
          ) : null}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
    </>
  );
}

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

export function UIMessageBody({ message }: { message: UIMessage }) {
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
