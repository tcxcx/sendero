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

import { useCallback, useMemo, useState, type JSX } from 'react';

import { useChat } from '@ai-sdk/react';
import { useUser } from '@clerk/nextjs';
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
import { ChatModelTrigger } from '@/components/chat/chat-model-trigger';
import { useChatModel } from '@/hooks/use-chat-model';

import { renderForOperator, type ChannelMessage } from '@/lib/channel-render';

interface Props {
  tenantId: string;
  /**
   * When true, every turn from this surface posts `playground: true`
   * in the body. The /api/agent/chat route forces sandbox routing on
   * the meter and applies per-user + per-IP rate limits when the flag
   * is set on a Clerk-session caller. Surfaces /playground/page.tsx.
   */
  playground?: boolean;
}

export function AgentChatClient({ tenantId, playground = false }: Props) {
  const [input, setInput] = useState('');

  const [chatModel] = useChatModel();
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/agent/chat',
        body: () => ({
          tenantId,
          channel: 'web' as const,
          model: chatModel,
          ...(playground ? { playground: true } : {}),
        }),
      }),
    [tenantId, chatModel, playground]
  );

  const { messages, sendMessage, status } = useChat({ transport });
  const busy = status === 'submitted' || status === 'streaming';

  // Per-message feedback state. Keyed on UIMessage.id so re-renders
  // during streaming don't lose the operator's selection. We never
  // un-set a rating — the thumb stays lit until the message is
  // re-streamed (new id).
  const [feedbackByMessage, setFeedbackByMessage] = useState<
    Record<string, 'up' | 'down' | 'sending' | undefined>
  >({});
  const submitFeedback = useCallback(
    async (messageId: string, traceId: string, rating: 'up' | 'down') => {
      setFeedbackByMessage(prev => ({ ...prev, [messageId]: 'sending' }));
      try {
        const res = await fetch('/api/agent/feedback', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ traceId, rating }),
        });
        if (!res.ok) throw new Error(`status ${res.status}`);
        setFeedbackByMessage(prev => ({ ...prev, [messageId]: rating }));
      } catch (err) {
        console.error('[agent-chat] feedback submit failed', err);
        setFeedbackByMessage(prev => ({ ...prev, [messageId]: undefined }));
      }
    },
    []
  );

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
        <div className="ml-auto">
          <ChatModelTrigger />
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
              const traceId = readTraceIdFromMessage(uiMessage);
              const feedbackState = feedbackByMessage[uiMessage.id];
              const showFeedback = role === 'assistant' && Boolean(traceId);
              const nodes = channelMessages.map(msg => (
                <div
                  key={msg.id}
                  className={
                    'flex w-full items-start gap-3 ' + (role === 'user' ? 'flex-row-reverse' : '')
                  }
                >
                  {role === 'user' ? <UserMessageAvatar /> : <AgentMessageAvatar />}
                  <Message from={role} className="!max-w-[calc(95%-44px)]">
                    {renderForOperator(msg)}
                  </Message>
                </div>
              ));
              if (showFeedback && traceId) {
                nodes.push(
                  <FeedbackStrip
                    key={`${uiMessage.id}-feedback`}
                    state={feedbackState}
                    onRate={rating => submitFeedback(uiMessage.id, traceId, rating)}
                  />
                );
              }
              return nodes;
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
    // Single Tool block per call — input + output collapsed inside the
    // same ToolContent. Emitting BOTH `tool_invocation` and `tool_result`
    // here used to double-render on the operator surface (QA #001).
    // Tools that want a separate share-card surface still emit a
    // distinct tool_result downstream; this path is the AI-SDK generic
    // case where the result is just JSON, not a share artifact.
    //
    // Special-case: tools that emit a structured `activation` payload
    // (book_esim today, future card-issuance / boarding-pass tools)
    // get rendered as an `esim_activation` ChannelMessage so the
    // operator preview matches what the traveler sees on Slack/WhatsApp.
    // The plain Tool block still surfaces alongside for the operator's
    // input/output forensics.
    const activation = readActivation(part.output);
    const staySearchResults = readStaySearchResults(part.output);
    const stayRatePicker = readStayRatePicker(part.output);
    const stayQuoteReview = readStayQuoteReview(part.output);
    const stayBookingConfirmation = readStayBookingConfirmation(part.output);
    out.push({
      kind: 'tool_invocation',
      id: `${partId}-inv`,
      author,
      toolName,
      input,
      status: 'done',
      result: part.output ?? null,
      createdAt: baseTime,
    });
    if (activation) {
      out.push({
        kind: 'esim_activation',
        id: `${partId}-activation`,
        author,
        esimId: activation.esimId,
        planLabel: activation.planLabel,
        countries: activation.countries,
        dataMb: activation.dataMb,
        validityDays: activation.validityDays,
        qrUrl: activation.qrUrl,
        lpaCode: activation.lpaCode,
        installUrl: activation.installUrl,
        ...(activation.priceLine ? { priceLine: activation.priceLine } : {}),
        ...(activation.expiresAt ? { expiresAt: activation.expiresAt } : {}),
        createdAt: baseTime,
      });
    }
    if (staySearchResults) {
      out.push({
        kind: 'stay_search_results',
        id: `${partId}-stay-search-results`,
        author,
        ...staySearchResults,
        createdAt: baseTime,
      });
    }
    if (stayRatePicker) {
      out.push({
        kind: 'stay_rate_picker',
        id: `${partId}-stay-rate-picker`,
        author,
        ...stayRatePicker,
        createdAt: baseTime,
      });
    }
    if (stayQuoteReview) {
      out.push({
        kind: 'stay_quote_review',
        id: `${partId}-stay-quote-review`,
        author,
        ...stayQuoteReview,
        createdAt: baseTime,
      });
    }
    if (stayBookingConfirmation) {
      out.push({
        kind: 'stay_booking_confirmation',
        id: `${partId}-stay-booking`,
        author,
        ...stayBookingConfirmation,
        createdAt: baseTime,
      });
    }
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
 * Pull a structured `activation` payload off a tool output (today only
 * `book_esim` populates it). Mirrors the validator in
 * `@sendero/agent::extractActivation` so a malformed entry degrades to
 * the plain Tool block rather than rendering a broken card.
 */
function readActivation(output: unknown): {
  esimId: string;
  planLabel: string;
  countries: string[];
  dataMb: number;
  validityDays: number;
  qrUrl: string;
  lpaCode: string;
  installUrl: string;
  priceLine?: string;
  expiresAt?: string;
} | null {
  if (!output || typeof output !== 'object') return null;
  const a = (output as { activation?: unknown }).activation;
  if (!a || typeof a !== 'object' || Array.isArray(a)) return null;
  const r = a as Record<string, unknown>;
  if (typeof r.esimId !== 'string') return null;
  if (typeof r.planLabel !== 'string') return null;
  if (typeof r.qrUrl !== 'string') return null;
  if (typeof r.lpaCode !== 'string') return null;
  if (typeof r.installUrl !== 'string') return null;
  if (typeof r.dataMb !== 'number') return null;
  if (typeof r.validityDays !== 'number') return null;
  if (!Array.isArray(r.countries) || !r.countries.every(c => typeof c === 'string')) return null;
  return {
    esimId: r.esimId,
    planLabel: r.planLabel,
    countries: r.countries as string[],
    dataMb: r.dataMb,
    validityDays: r.validityDays,
    qrUrl: r.qrUrl,
    lpaCode: r.lpaCode,
    installUrl: r.installUrl,
    ...(typeof r.priceLine === 'string' ? { priceLine: r.priceLine } : {}),
    ...(typeof r.expiresAt === 'string' ? { expiresAt: r.expiresAt } : {}),
  };
}

/**
 * Extractors for the three Stays-side structured payloads. The tool
 * layer (`list_stay_rates` / `quote_stay` / `book_stay`) attaches a typed
 * blob alongside the raw Duffel response; if the blob isn't well-formed,
 * we fall through to the plain Tool block rather than rendering a broken
 * card. Mirrors `readActivation` for `book_esim`.
 */
function readStaySearchResults(output: unknown): StaySearchResultsPayload | null {
  if (!output || typeof output !== 'object') return null;
  const r = (output as { staySearchResults?: unknown }).staySearchResults;
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  const x = r as Record<string, unknown>;
  if (typeof x.checkInDate !== 'string' || typeof x.checkOutDate !== 'string') return null;
  if (!Array.isArray(x.hotels)) return null;
  if (!x.business || typeof x.business !== 'object') return null;
  return x as unknown as StaySearchResultsPayload;
}

function readStayRatePicker(output: unknown): StayRatePickerPayload | null {
  if (!output || typeof output !== 'object') return null;
  const r = (output as { stayRatePicker?: unknown }).stayRatePicker;
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  const x = r as Record<string, unknown>;
  if (typeof x.searchResultId !== 'string') return null;
  if (!x.accommodation || typeof x.accommodation !== 'object') return null;
  if (!Array.isArray(x.rates)) return null;
  if (!x.business || typeof x.business !== 'object') return null;
  return x as unknown as StayRatePickerPayload;
}

function readStayQuoteReview(output: unknown): StayQuoteReviewPayload | null {
  if (!output || typeof output !== 'object') return null;
  const r = (output as { stayQuoteReview?: unknown }).stayQuoteReview;
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  const x = r as Record<string, unknown>;
  if (typeof x.quoteId !== 'string') return null;
  if (!x.accommodation || typeof x.accommodation !== 'object') return null;
  if (!x.billing || typeof x.billing !== 'object') return null;
  if (!Array.isArray(x.cancellationTimeline)) return null;
  if (!Array.isArray(x.conditions)) return null;
  if (!x.business || typeof x.business !== 'object') return null;
  return x as unknown as StayQuoteReviewPayload;
}

function readStayBookingConfirmation(output: unknown): StayBookingConfirmationPayload | null {
  if (!output || typeof output !== 'object') return null;
  const r = (output as { stayBookingConfirmation?: unknown }).stayBookingConfirmation;
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  const x = r as Record<string, unknown>;
  if (typeof x.bookingId !== 'string') return null;
  if (typeof x.reference !== 'string') return null;
  if (!x.accommodation || typeof x.accommodation !== 'object') return null;
  if (!x.billing || typeof x.billing !== 'object') return null;
  return x as unknown as StayBookingConfirmationPayload;
}

type StaySearchResultsPayload = Omit<
  Extract<ChannelMessage, { kind: 'stay_search_results' }>,
  'kind' | 'id' | 'author' | 'createdAt'
>;
type StayRatePickerPayload = Omit<
  Extract<ChannelMessage, { kind: 'stay_rate_picker' }>,
  'kind' | 'id' | 'author' | 'createdAt'
>;
type StayQuoteReviewPayload = Omit<
  Extract<ChannelMessage, { kind: 'stay_quote_review' }>,
  'kind' | 'id' | 'author' | 'createdAt'
>;
type StayBookingConfirmationPayload = Omit<
  Extract<ChannelMessage, { kind: 'stay_booking_confirmation' }>,
  'kind' | 'id' | 'author' | 'createdAt'
>;

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

// ─── Avatars ────────────────────────────────────────────────────────────
//
// Same shape as meta-inbox-live's avatars so the two surfaces match.
// User: bordered circle, ink fill, Clerk profile photo (or initial).
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

/**
 * Read the live Langfuse trace id off a streamed UIMessage. The chat
 * route writes it as `senderoTraceId` via `messageMetadata({ part:
 * 'start' })`, so it lands on the assistant message as soon as the
 * stream begins. Returns undefined for user/system messages.
 */
function readTraceIdFromMessage(message: UIMessage): string | undefined {
  const meta = (message as { metadata?: { senderoTraceId?: unknown } }).metadata;
  const id = meta?.senderoTraceId;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

/**
 * Compact thumbs-up / thumbs-down strip rendered under each assistant
 * message. POSTs to /api/agent/feedback which calls
 * `scoreGeneration(traceId, 'up'|'down')` — the score lands as a
 * `user-feedback` BOOLEAN on the trace produced by this turn.
 */
function FeedbackStrip({
  state,
  onRate,
}: {
  state: 'up' | 'down' | 'sending' | undefined;
  onRate: (rating: 'up' | 'down') => void | Promise<void>;
}): JSX.Element {
  const sending = state === 'sending';
  const rated = state === 'up' || state === 'down';
  return (
    <div className="ml-12 mt-1 mb-2 flex items-center gap-1.5 text-muted-foreground">
      <button
        type="button"
        disabled={sending || rated}
        onClick={() => onRate('up')}
        aria-label="Rate response up"
        className={
          'rounded-md border border-transparent px-1.5 py-0.5 font-mono text-[11px] leading-none transition-colors ' +
          (state === 'up'
            ? 'border-[color:var(--hairline-color-strong)] bg-[color:color-mix(in_oklab,var(--midnight)_8%,transparent)] text-[color:var(--midnight)]'
            : 'hover:bg-[color:color-mix(in_oklab,var(--midnight)_5%,transparent)]')
        }
      >
        ▲
      </button>
      <button
        type="button"
        disabled={sending || rated}
        onClick={() => onRate('down')}
        aria-label="Rate response down"
        className={
          'rounded-md border border-transparent px-1.5 py-0.5 font-mono text-[11px] leading-none transition-colors ' +
          (state === 'down'
            ? 'border-[color:var(--hairline-color-strong)] bg-[color:color-mix(in_oklab,var(--vermillion)_10%,transparent)] text-[color:var(--vermillion)]'
            : 'hover:bg-[color:color-mix(in_oklab,var(--midnight)_5%,transparent)]')
        }
      >
        ▼
      </button>
      {sending ? (
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] opacity-60">…</span>
      ) : rated ? (
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] opacity-60">Logged</span>
      ) : null}
    </div>
  );
}
