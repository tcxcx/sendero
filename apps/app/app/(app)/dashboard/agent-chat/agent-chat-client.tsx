'use client';

/**
 * AgentChatClient — operator-facing test bench for the canonical
 * channel-render layer. Composes AI Elements primitives via the
 * `renderForOperator` adapter, so every message displayed here is
 * also a valid `ChannelMessage` that other channel renderers will
 * emit faithfully on WhatsApp / Slack / web.
 *
 * Backend: streaming POST /api/agent/chat (channel='web') via the AI
 * SDK v6 UI-message stream. We use `useChat` from `@ai-sdk/react`
 * with `DefaultChatTransport`, then map each streaming `UIMessage`
 * onto a fan-out of canonical `ChannelMessage` rows so the same
 * operator render path keeps working. Tool invocations, results, and
 * reasoning all surface token-by-token.
 */

import { useMemo, useState, type JSX } from 'react';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage, type UIMessagePart } from 'ai';

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import { Message } from '@/components/ai-elements/message';
import { Persona, type PersonaState } from '@/components/ai-elements/persona';
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from '@/components/ai-elements/prompt-input';
import { AgentPersona } from '@/components/agent-chat/agent-persona';

import { renderForOperator, type ChannelMessage } from '@/lib/channel-render';

interface Props {
  tenantId: string;
}

export function AgentChatClient({ tenantId }: Props) {
  const [input, setInput] = useState('');

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/agent/chat',
        body: { tenantId, channel: 'web' },
      }),
    [tenantId]
  );

  const { messages, sendMessage, status } = useChat({ transport });
  const busy = status === 'submitted' || status === 'streaming';

  // Map AI SDK chat status → Persona state. The Persona is mounted
  // ONCE in the sticky header (Rive WebGL2 context is ~190KB gzipped
  // and a single GPU context — never per-message). idle/listening/
  // thinking/speaking/asleep are the variants that ship with the
  // halo Persona; we use them as a tactile indicator the operator
  // can feel without watching token counters.
  const personaState: PersonaState = (() => {
    if (status === 'submitted') return 'thinking';
    if (status === 'streaming') return 'speaking';
    if (input.length > 0) return 'listening';
    if (messages.length === 0) return 'asleep';
    return 'idle';
  })();

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col">
      {/* Sticky agent persona header — Rive WebGL2 mounted once.
          Reflects chat lifecycle (asleep at empty → listening as the
          operator types → thinking on submit → speaking while the
          response streams → idle when settled). */}
      <header className="flex items-center gap-3 border-b border-border bg-card/40 px-4 py-3">
        <Persona className="size-10 shrink-0" state={personaState} variant="halo" />
        <AgentPersona className="size-10" state={personaState} />
        <div className="flex flex-col gap-0.5">
          <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            Sendero AI
          </div>
          <div className="text-xs text-muted-foreground">{personaStateLabel(personaState)}</div>
        </div>
      </header>

      <Conversation className="flex-1">
        <ConversationContent>
          {messages.length === 0 ? (
            <EmptyState />
          ) : (
            messages.flatMap(uiMessage => {
              const channelMessages = uiMessageToChannelMessages(uiMessage);
              const role = mapRole(uiMessage.role);
              return channelMessages.map(msg => (
                <Message key={msg.id} from={role}>
                  {renderForOperator(msg)}
                </Message>
              ));
            })
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <PromptInput
        onSubmit={(message, evt) => {
          evt.preventDefault();
          const text = (message.text || input).trim();
          const files = message.files ?? [];
          if ((!text && files.length === 0) || busy) return;
          // Pass files alongside text — the AI SDK turns FileUIPart[] into
          // image/file message parts the model sees natively. The agent
          // routes them to `scan_document_auto` for kind detection +
          // extraction (see lib/agent-system-prompt.ts).
          if (files.length > 0) {
            void sendMessage({ text: text || ' ', files });
          } else {
            void sendMessage({ text });
          }
          setInput('');
        }}
        className="border-t border-border"
      >
        <PromptInputBody>
          <PromptInputTextarea
            value={input}
            onChange={evt => setInput(evt.target.value)}
            placeholder="Ask Sendero anything · /scope @trp- · /policy · /spend"
            disabled={busy}
          />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools />
          <PromptInputSubmit
            disabled={busy || input.trim().length === 0}
            status={busy ? 'submitted' : undefined}
          />
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
}

function EmptyState(): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-12 text-center">
      <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
        Sendero AI · ready
      </div>
      <div className="max-w-md text-sm text-muted-foreground">
        Ask the agent to search flights, run policy checks, propose order changes, or recommend
        restaurants. Tool calls render inline — the same canonical messages that flow to WhatsApp /
        Slack / web travelers.
      </div>
    </div>
  );
}

/**
 * Map AI SDK UIMessage roles to the AI Elements `<Message from>` enum.
 * The renderer-side roles are a wider union (operator/traveler/system)
 * because canonical ChannelMessages flow across channels; the AI
 * Elements wrapper only cares about user / assistant / system bubbles.
 */
function mapRole(role: UIMessage['role']): 'user' | 'assistant' | 'system' {
  if (role === 'user') return 'user';
  if (role === 'system') return 'system';
  return 'assistant';
}

/**
 * Fan a single AI SDK `UIMessage` out into the canonical
 * `ChannelMessage[]` the operator renderer consumes. One UIMessage
 * may carry many parts: a streaming text body, several tool calls
 * each with their own state machine (`input-streaming` -> `input-
 * available` -> `output-available` | `output-error`), reasoning
 * blocks, and source citations. We emit one ChannelMessage per
 * surface so renderForOperator can paint each part with the right
 * AI Elements primitive (text bubble, Tool block, Reasoning, etc.).
 *
 * The mapping is one-way and stateless: the same UIMessage produces
 * the same ChannelMessage[] each render. Streaming updates flow
 * through because parts mutate in place inside useChat's state.
 */
export function uiMessageToChannelMessages(message: UIMessage): ChannelMessage[] {
  const author =
    message.role === 'user'
      ? ({ role: 'operator', name: 'You' } as const)
      : message.role === 'system'
        ? ({ role: 'system', name: 'Sendero AI' } as const)
        : ({ role: 'agent', name: 'Sendero AI' } as const);
  const baseTime = new Date().toISOString();
  const out: ChannelMessage[] = [];
  const parts = message.parts ?? [];
  // Aggregate sources across the whole message into one canonical
  // sources block so we don't fragment citations across the rendered
  // bubbles when the model emits them interspersed.
  const sources: Array<{ title: string; url: string; snippet?: string }> = [];

  parts.forEach((part, i) => {
    const partId = `${message.id}-${i}`;
    const t = part.type;
    if (t === 'text') {
      const text = (part as { text?: string }).text ?? '';
      if (!text) return;
      out.push({
        kind: 'text',
        id: partId,
        author,
        content: text,
        createdAt: baseTime,
      });
      return;
    }
    if (t === 'reasoning') {
      const text = (part as { text?: string }).text ?? '';
      if (!text) return;
      out.push({
        kind: 'reasoning',
        id: partId,
        author,
        content: text,
        collapsedByDefault: true,
        createdAt: baseTime,
      });
      return;
    }
    if (t === 'source-url') {
      const url = (part as { url?: string }).url ?? '';
      if (!url) return;
      sources.push({
        title: (part as { title?: string }).title ?? url,
        url,
      });
      return;
    }
    if (t === 'source-document') {
      sources.push({
        title: (part as { title?: string }).title ?? 'Document',
        url: (part as { url?: string }).url ?? '#',
      });
      return;
    }
    if (typeof t === 'string' && t.startsWith('tool-')) {
      pushToolMessages({
        out,
        author,
        baseTime,
        partId,
        toolName: t.slice('tool-'.length),
        part,
      });
      return;
    }
    if (t === 'dynamic-tool') {
      pushToolMessages({
        out,
        author,
        baseTime,
        partId,
        toolName: (part as { toolName?: string }).toolName ?? 'tool',
        part,
      });
      return;
    }
    // step-start / file / data-* parts are intentionally not surfaced
    // through the canonical message shape today; operator renderer
    // would have nothing meaningful to paint.
  });

  if (sources.length > 0) {
    out.push({
      kind: 'sources',
      id: `${message.id}-sources`,
      author,
      items: sources,
      createdAt: baseTime,
    });
  }

  return out;
}

/**
 * Map a single tool UI part (typed `tool-<name>` or `dynamic-tool`)
 * into the canonical invocation/result pair. State machine:
 *   - input-streaming / input-available  -> tool_invocation only
 *   - output-available                    -> invocation + result
 *   - output-error                        -> invocation only, error
 *   - approval-requested / -responded     -> invocation, treated as
 *     pending so the operator sees the in-flight state.
 */
function pushToolMessages(args: {
  out: ChannelMessage[];
  author: ChannelMessage['author'];
  baseTime: string;
  partId: string;
  toolName: string;
  part: UIMessagePart<Record<string, unknown>, Record<string, never>> | unknown;
}): void {
  const { out, author, baseTime, partId, toolName } = args;
  const part = args.part as {
    state?: string;
    input?: unknown;
    output?: unknown;
    errorText?: string;
    toolCallId?: string;
  };
  const state = part.state ?? 'input-streaming';
  const input = (part.input ?? {}) as Record<string, unknown>;

  if (state === 'output-available') {
    out.push({
      kind: 'tool_invocation',
      id: `${partId}-inv`,
      author,
      toolName,
      input,
      status: 'done',
      createdAt: baseTime,
    });
    out.push({
      kind: 'tool_result',
      id: `${partId}-res`,
      author,
      toolName,
      result: part.output ?? null,
      createdAt: baseTime,
    });
    return;
  }
  if (state === 'output-error') {
    out.push({
      kind: 'tool_invocation',
      id: `${partId}-inv`,
      author,
      toolName,
      input,
      status: 'error',
      errorMessage: part.errorText ?? 'tool error',
      createdAt: baseTime,
    });
    return;
  }
  // input-streaming, input-available, approval-requested,
  // approval-responded, output-denied — all surface as a pending
  // invocation so the operator sees activity until terminal state.
  out.push({
    kind: 'tool_invocation',
    id: `${partId}-inv`,
    author,
    toolName,
    input,
    status: state === 'input-available' ? 'streaming' : 'pending',
    createdAt: baseTime,
  });
}

/**
 * Tiny human-readable status under the persona avatar. Matches the
 * Persona state machine 1:1 — the eyebrow/copy never lies about what
 * the underlying chat status is.
 */
function personaStateLabel(state: PersonaState): string {
  switch (state) {
    case 'asleep':
      return 'Tap a prompt to wake the agent';
    case 'listening':
      return 'Listening…';
    case 'thinking':
      return 'Thinking — running tools';
    case 'speaking':
      return 'Streaming response';
    case 'idle':
      return 'Ready';
  }
}
