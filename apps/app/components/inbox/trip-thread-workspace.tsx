'use client';

/**
 * TripThreadWorkspace — the main trip-thread surface inside the
 * authenticated inbox. This is where an operator (human) and the
 * Sendero AI agent collaborate on a single trip before anything is
 * broadcast to the traveler's channel.
 *
 * Left: transcript (agent + operator + system turns), rendered with
 *   AI Elements `Conversation`, `Message`, `Tool`, `TripToolCard`.
 * Right side panel (above/below on mobile): trip summary, traveler
 *   contact, handoff toggle, booking + channel metadata.
 * Composer: channel-aware + internal/send + agent/human modes.
 *
 * Backend:
 *   - `useChat` posts to `/api/chat` with `context.tripId` + `context.tenantId`
 *     so the Sendero agent can scope its tool calls to this trip.
 *   - "Reply via {channel}" submits to `/api/inbox/[tripId]/reply`.
 *     (MVP: endpoint accepts the payload and persists an outbound log
 *     entry — real channel delivery is wired per-channel.)
 *
 * Motion: property-specific transitions ≤ 200ms. No scale-from-zero.
 * Emil rules: one clear next action, message attribution obvious at a
 * glance, channel origin never hidden.
 */

import { useCallback, useState } from 'react';

import { useChat } from '@ai-sdk/react';
import { useUser } from '@clerk/nextjs';
import { DefaultChatTransport } from 'ai';
import { BotIcon, EyeOffIcon, ShieldCheckIcon, UserIcon } from 'lucide-react';

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message';
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning';
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from '@/components/ai-elements/tool';
import { ChannelBadge, type ChannelKindSlug } from '@/components/inbox/channel-badge';
import {
  TripThreadComposer,
  type TripThreadComposerSubmit,
} from '@/components/inbox/trip-thread-composer';
import { TripToolCard } from '@/components/trip-tool-cards';

export interface TripThreadContext {
  tripId: string;
  tenantId: string;
  tenantName?: string;
  title: string;
  status: string;
  intent?: {
    origin?: string;
    destination?: string;
    purpose?: string;
    dates?: string;
  } | null;
  traveler?: {
    name?: string;
    email?: string;
    phone?: string;
  } | null;
  channels: ChannelKindSlug[];
  defaultChannel: ChannelKindSlug;
  booking?: {
    pnr?: string;
    totalAmount?: string;
    totalCurrency?: string;
  } | null;
}

type ChatPart = {
  type?: string;
  text?: string;
  reasoning?: string;
  state?: string;
  status?: string;
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  result?: unknown;
  errorText?: string;
  toolInvocation?: {
    toolCallId?: string;
    toolName?: string;
    state?: string;
    input?: unknown;
    result?: unknown;
    errorText?: string;
  };
};

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  parts?: ChatPart[];
};

interface OutboundEntry {
  id: string;
  kind: 'channel' | 'internal';
  channel: ChannelKindSlug;
  text: string;
  authorName: string;
  createdAt: string;
}

export function TripThreadWorkspace({ trip }: { trip: TripThreadContext }) {
  const { user } = useUser();
  const [aiEnabled, setAiEnabled] = useState(true);
  const [outbound, setOutbound] = useState<OutboundEntry[]>([]);
  const [sendBusy, setSendBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const operator = user
    ? {
        name: user.fullName ?? user.firstName ?? 'Operator',
        email: user.primaryEmailAddress?.emailAddress ?? '',
        phone: user.primaryPhoneNumber?.phoneNumber ?? '',
      }
    : { name: 'Operator', email: '', phone: '' };

  const { messages, sendMessage, status, stop, error } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/chat',
      body: () => ({
        traveler: operator,
        context: {
          tripId: trip.tripId,
          tenantId: trip.tenantId,
          tenantName: trip.tenantName,
          tripTitle: trip.title,
          tripStatus: trip.status,
          tripIntent: trip.intent,
          tripTraveler: trip.traveler,
          tripChannels: trip.channels,
          defaultChannel: trip.defaultChannel,
          booking: trip.booking,
          aiHandoff: aiEnabled ? 'agent' : 'human',
          surface: 'trip_inbox',
        },
      }),
    }),
  });

  const isStreaming = status === 'streaming' || status === 'submitted';

  const handleSubmit = useCallback(
    async (m: TripThreadComposerSubmit) => {
      setSendError(null);
      if (m.mode === 'agent') {
        sendMessage({ text: m.text });
        return;
      }
      setSendBusy(true);
      try {
        const res = await fetch(`/api/inbox/${encodeURIComponent(trip.tripId)}/reply`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            channel: m.channel,
            isInternal: m.isInternal,
            text: m.text,
            authorName: operator.name,
          }),
        });
        if (!res.ok) {
          const body = await res.text();
          throw new Error(`Send failed (${res.status}): ${body.slice(0, 200)}`);
        }
        const payload = (await res.json()) as { id?: string; createdAt?: string };
        setOutbound(prev => [
          ...prev,
          {
            id: payload.id || `${Date.now()}`,
            kind: m.isInternal ? 'internal' : 'channel',
            channel: m.channel,
            text: m.text,
            authorName: operator.name,
            createdAt: payload.createdAt || new Date().toISOString(),
          },
        ]);
      } catch (err) {
        setSendError(err instanceof Error ? err.message : 'Send failed');
      } finally {
        setSendBusy(false);
      }
    },
    [operator.name, sendMessage, trip.tripId]
  );

  const channels = trip.channels.length ? trip.channels : [trip.defaultChannel];

  return (
    <div className="flex min-h-0 flex-1 flex-row overflow-hidden bg-background">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <TripThreadHeader
          trip={trip}
          aiEnabled={aiEnabled}
          onToggleAi={setAiEnabled}
          channels={channels}
        />
        <div className="flex-1 overflow-y-auto">
          <Conversation className="h-full">
            <ConversationContent className="gap-5 px-5 py-5">
              {messages.length === 0 && outbound.length === 0 ? <EmptyThread trip={trip} /> : null}
              {messages.map(m => (
                <ChatMessageView
                  key={m.id}
                  message={m as unknown as ChatMessage}
                  operatorName={operator.name}
                />
              ))}
              {outbound.map(o => (
                <OutboundMessageView key={o.id} entry={o} />
              ))}
              {error ? (
                <div className="rounded-lg border border-[color:var(--accent-rose)]/40 bg-[color:var(--accent-rose)]/5 px-3 py-2 text-xs text-[color:var(--accent-rose)]">
                  {error.message}
                </div>
              ) : null}
              {sendError ? (
                <div className="rounded-lg border border-[color:var(--accent-rose)]/40 bg-[color:var(--accent-rose)]/5 px-3 py-2 text-xs text-[color:var(--accent-rose)]">
                  {sendError}
                </div>
              ) : null}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>
        </div>
        <TripThreadComposer
          defaultChannel={trip.defaultChannel}
          disabled={sendBusy || isStreaming}
          onSubmit={handleSubmit}
        />
        {isStreaming ? (
          <div className="flex items-center justify-end border-t border-border px-4 py-1.5 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            <button
              type="button"
              onClick={() => stop()}
              className="font-mono hover:text-[color:var(--ink)]"
            >
              streaming… · stop
            </button>
          </div>
        ) : null}
      </div>
      <TripSidePanel trip={trip} aiEnabled={aiEnabled} />
    </div>
  );
}

function TripThreadHeader({
  trip,
  aiEnabled,
  onToggleAi,
  channels,
}: {
  trip: TripThreadContext;
  aiEnabled: boolean;
  onToggleAi: (next: boolean) => void;
  channels: ChannelKindSlug[];
}) {
  return (
    <header className="flex flex-col gap-2 border-b border-border bg-[color:var(--panel)] px-5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {trip.status}
        </span>
        <h1 className="truncate text-base font-medium text-[color:var(--ink)]">{trip.title}</h1>
        <div className="ml-auto flex items-center gap-2">
          {channels.map(c => (
            <ChannelBadge key={c} channel={c} size="xs" />
          ))}
          <HandoffToggle enabled={aiEnabled} onChange={onToggleAi} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] text-muted-foreground">
        {trip.intent?.origin && trip.intent?.destination ? (
          <span>
            {trip.intent.origin} → {trip.intent.destination}
          </span>
        ) : null}
        {trip.intent?.dates ? <span>{trip.intent.dates}</span> : null}
        {trip.booking?.pnr ? (
          <span className="text-[color:var(--ink)]">PNR {trip.booking.pnr}</span>
        ) : null}
        <span className="truncate">Trip · {trip.tripId.slice(0, 12)}</span>
      </div>
    </header>
  );
}

function HandoffToggle({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      aria-pressed={enabled}
      className={
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors duration-150 ease-out ' +
        (enabled
          ? 'border-[color:var(--accent-green)]/50 text-[color:var(--accent-green)]'
          : 'border-border text-muted-foreground hover:border-[color:var(--ink)] hover:text-[color:var(--ink)]')
      }
    >
      <ShieldCheckIcon className="size-3" />
      {enabled ? 'AI on' : 'Human only'}
    </button>
  );
}

function EmptyThread({ trip }: { trip: TripThreadContext }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-[color:var(--panel)] px-4 py-6 text-sm text-muted-foreground">
      <div className="font-medium text-[color:var(--ink)]">Start a thread on this trip.</div>
      <p className="mt-1">
        Ask the agent to summarize the trip, draft a reply, or run tools. Use Human mode to message
        the traveler directly via {trip.defaultChannel}. Internal notes stay in this thread.
      </p>
    </div>
  );
}

function ChatMessageView({
  message,
  operatorName,
}: {
  message: ChatMessage;
  operatorName: string;
}) {
  const parts = message.parts ?? [];
  const textContent = parts
    .filter(p => p.type === 'text')
    .map(p => p.text ?? '')
    .join('');
  const reasoningParts = parts.filter(p => p.type === 'reasoning');
  const toolCalls = parts.filter(
    p => p.type === 'tool-invocation' || (typeof p.type === 'string' && p.type.startsWith('tool-'))
  );
  const isUser = message.role === 'user';

  return (
    <div className="flex items-start gap-3">
      <AuthorAvatar role={message.role} operatorName={operatorName} />
      <Message className="max-w-none flex-1 gap-2" from={message.role}>
        <AuthorLine role={message.role} operatorName={operatorName} internalOnly />
        <MessageContent
          className={
            isUser
              ? 'max-w-[85%] rounded-[18px] bg-[color:var(--bg-soft)] px-3.5 py-2.5 text-[color:var(--ink)]'
              : 'max-w-full rounded-[18px] border border-border bg-[color:var(--panel)] px-3.5 py-2.5 text-[color:var(--text)]'
          }
        >
          {textContent ? (
            <MessageResponse className="text-sm leading-6">{textContent}</MessageResponse>
          ) : null}
          {reasoningParts.map(part => {
            const text = part.text ?? part.reasoning ?? '';
            if (!text) return null;
            return (
              <Reasoning
                key={text.slice(0, 64)}
                defaultOpen={false}
                isStreaming={part.state === 'streaming' || part.status === 'streaming'}
              >
                <ReasoningTrigger />
                <ReasoningContent>{text}</ReasoningContent>
              </Reasoning>
            );
          })}
        </MessageContent>
        {toolCalls.map(p => (
          <ToolCallView
            key={
              p.toolCallId ||
              p.toolInvocation?.toolCallId ||
              `${p.toolName || p.type}-${p.state || 'idle'}`
            }
            part={p}
          />
        ))}
      </Message>
    </div>
  );
}

function AuthorAvatar({ role, operatorName }: { role: ChatMessage['role']; operatorName: string }) {
  const initials =
    role === 'user'
      ? (
          operatorName
            .split(/\s+/)
            .map(w => w[0])
            .slice(0, 2)
            .join('') || 'OP'
        ).toUpperCase()
      : 'PS';
  const color =
    role === 'user'
      ? 'bg-[color:var(--bg-soft)] text-[color:var(--ink)]'
      : 'bg-[color:var(--ink)] text-[color:var(--panel)]';
  return (
    <div
      className={`mt-1 grid size-8 shrink-0 place-items-center rounded-full font-mono text-[10px] uppercase tracking-[0.08em] ${color}`}
    >
      {initials}
    </div>
  );
}

function AuthorLine({
  role,
  operatorName,
  internalOnly,
}: {
  role: ChatMessage['role'];
  operatorName: string;
  internalOnly?: boolean;
}) {
  const label = role === 'user' ? operatorName : role === 'assistant' ? 'Sendero agent' : 'System';
  const tag =
    role === 'user' ? (
      <UserIcon className="size-3" />
    ) : role === 'assistant' ? (
      <BotIcon className="size-3" />
    ) : null;
  return (
    <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
      {tag}
      <span>{label}</span>
      {internalOnly ? (
        <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-1.5 py-0.5 text-[9px]">
          <EyeOffIcon className="size-2.5" />
          draft · not sent
        </span>
      ) : null}
    </div>
  );
}

function ToolCallView({ part }: { part: ChatPart }) {
  const toolName =
    part.toolName ||
    part.toolInvocation?.toolName ||
    (typeof part.type === 'string' ? part.type.replace('tool-', '') : 'tool');
  const state = (part.state || part.toolInvocation?.state || 'running') as
    | 'approval-requested'
    | 'approval-responded'
    | 'input-available'
    | 'input-streaming'
    | 'output-available'
    | 'output-denied'
    | 'output-error';
  const input = part.input || part.toolInvocation?.input;
  const result = part.output || part.result || part.toolInvocation?.result;
  const errorText = part.errorText || part.toolInvocation?.errorText;
  const label = toolName
    ? toolName.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
    : 'Tool';

  return (
    <Tool className="overflow-hidden border-border bg-[color:var(--bg-soft)]">
      <ToolHeader state={state} title={label} toolName={toolName} type="dynamic-tool" />
      <ToolContent>
        {input ? <ToolInput input={input} /> : null}
        <TripToolCard toolName={toolName} result={result} />
        <ToolOutput errorText={errorText} output={result} />
      </ToolContent>
    </Tool>
  );
}

function OutboundMessageView({ entry }: { entry: OutboundEntry }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-1 grid size-8 shrink-0 place-items-center rounded-full bg-[color:var(--bg-soft)] font-mono text-[10px] uppercase tracking-[0.08em] text-[color:var(--ink)]">
        {entry.authorName
          .split(/\s+/)
          .map(w => w[0])
          .slice(0, 2)
          .join('')
          .toUpperCase() || 'OP'}
      </div>
      <div className="max-w-none flex-1 gap-2">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          <UserIcon className="size-3" />
          <span>{entry.authorName}</span>
          <ChannelBadge channel={entry.channel} size="xs" />
          {entry.kind === 'internal' ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-1.5 py-0.5 text-[9px]">
              <EyeOffIcon className="size-2.5" />
              internal
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full border border-[color:var(--accent-green)]/40 px-1.5 py-0.5 text-[9px] text-[color:var(--accent-green)]">
              sent
            </span>
          )}
          <span className="ml-auto text-[10px] text-muted-foreground">
            {new Date(entry.createdAt).toLocaleTimeString()}
          </span>
        </div>
        <div
          className={
            'mt-1 rounded-[18px] px-3.5 py-2.5 text-sm leading-6 ' +
            (entry.kind === 'internal'
              ? 'border border-dashed border-border bg-[color:var(--bg-soft)] text-[color:var(--text)]'
              : 'border border-[color:var(--accent-green)]/30 bg-[color:var(--accent-green)]/5 text-[color:var(--ink)]')
          }
        >
          {entry.text}
        </div>
      </div>
    </div>
  );
}

function TripSidePanel({ trip, aiEnabled }: { trip: TripThreadContext; aiEnabled: boolean }) {
  return (
    <aside
      style={{ width: '22rem' }}
      className="flex shrink-0 flex-col border-l border-border bg-muted/10"
    >
      <div className="flex flex-col gap-3 border-b border-border px-4 py-4">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Trip
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            {aiEnabled ? 'Agent on' : 'Human only'}
          </span>
        </div>
        <div className="text-sm font-medium text-[color:var(--ink)]">{trip.title}</div>
        {trip.intent?.purpose ? (
          <div className="text-xs text-muted-foreground">{trip.intent.purpose}</div>
        ) : null}
      </div>
      <PanelRow label="Tenant" value={trip.tenantName ?? trip.tenantId.slice(0, 10)} />
      <PanelRow
        label="Traveler"
        value={trip.traveler?.name ?? 'Not linked'}
        sub={trip.traveler?.email}
      />
      {trip.traveler?.phone ? <PanelRow label="Phone" value={trip.traveler.phone} /> : null}
      {trip.booking?.pnr ? (
        <PanelRow
          label="PNR"
          value={trip.booking.pnr}
          sub={
            trip.booking.totalAmount
              ? `${trip.booking.totalAmount} ${trip.booking.totalCurrency ?? ''}`
              : undefined
          }
        />
      ) : null}
      <PanelRow
        label="Channels"
        value={trip.channels.length > 0 ? trip.channels.join(' · ') : '—'}
      />
      <div className="flex-1" />
      <div className="border-t border-border px-4 py-3 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        Handoff toggle in header controls whether the agent can reply on its own. Human-only mode
        means nothing sends to the traveler without an operator clicking Reply.
      </div>
    </aside>
  );
}

function PanelRow({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border-b border-border px-4 py-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 text-sm text-[color:var(--ink)]">{value}</div>
      {sub ? <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{sub}</div> : null}
    </div>
  );
}
