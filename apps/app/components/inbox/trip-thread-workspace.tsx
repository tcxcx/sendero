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
  /** Traveler locale (BCP-47). Drives rewrite language in the composer. */
  travelerLocale: string;
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
    // Borderless workspace: thread panel is a raised card, side panel
    // is a stack of mini-cards — no dividers between layout regions.
    <div className="flex min-h-0 flex-1 flex-row gap-4 overflow-hidden bg-[color:var(--surface-base)] p-4">
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-lg)] bg-[color:var(--surface-raised)] shadow-[var(--shadow-md)]">
        <TripThreadHeader
          trip={trip}
          aiEnabled={aiEnabled}
          onToggleAi={setAiEnabled}
          channels={channels}
        />
        <div className="flex-1 overflow-y-auto">
          <Conversation className="h-full">
            <ConversationContent className="gap-5 px-6 py-6">
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
                <div className="rounded-[var(--radius-sm)] bg-[color:var(--accent-rose)]/5 px-3 py-2 text-xs text-[color:var(--accent-rose)] shadow-[var(--shadow-xs)]">
                  {error.message}
                </div>
              ) : null}
              {sendError ? (
                <div className="rounded-[var(--radius-sm)] bg-[color:var(--accent-rose)]/5 px-3 py-2 text-xs text-[color:var(--accent-rose)] shadow-[var(--shadow-xs)]">
                  {sendError}
                </div>
              ) : null}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>
        </div>
        <div className="px-4 pb-4">
          <TripThreadComposer
            defaultChannel={trip.defaultChannel}
            disabled={sendBusy || isStreaming}
            onSubmit={handleSubmit}
            customerName={trip.traveler?.name}
            tripStatus={trip.status}
            locale={trip.travelerLocale}
          />
        </div>
        {isStreaming ? (
          <div className="flex items-center justify-end px-6 pb-3 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            <button
              type="button"
              onClick={() => stop()}
              className="font-mono hover:text-[color:var(--ink)]"
            >
              streaming… · stop
            </button>
          </div>
        ) : null}
      </section>
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
    // Borderless header inside the raised thread card (DESIGN.md §19).
    <header className="flex flex-col gap-2 px-6 pt-5 pb-4">
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
      {/* Intent + PNR — rendered only when a field carries meaning.
          No static trip-id slug: the URL already encodes it. */}
      {trip.intent?.origin || trip.intent?.dates || trip.booking?.pnr ? (
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
        </div>
      ) : null}
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
    // No dashed border — parchment surface nested inside the raised
    // thread card, 32px padding, a binocular mark at 20% opacity above
    // the headline (DESIGN.md §19, Empty States).
    <div className="flex flex-col items-center gap-3 rounded-[var(--radius-lg)] bg-[color:var(--surface-base)] px-6 py-10 text-center">
      <img
        alt=""
        aria-hidden="true"
        className="h-8 w-8 opacity-20"
        src="/brand/logo-masters/clean/sendero_icon_vermilion_clean_2048.png"
      />
      <div className="text-sm font-medium text-[color:var(--ink)]">
        Start a thread on this trip.
      </div>
      <p className="max-w-md text-xs text-muted-foreground">
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
  // Only show rows that carry real data — no "Not linked", no em-dash
  // placeholders. The org switcher in the app header already carries
  // tenant identity, so we don't duplicate it here.
  const hasTraveler = Boolean(trip.traveler?.name || trip.traveler?.email || trip.traveler?.phone);
  const hasChannels = trip.channels.length > 0;
  const travelerSub = trip.traveler?.email ?? trip.traveler?.phone;

  return (
    // Borderless column of floating mini-cards on parchment — no left
    // rule, no internal horizontal lines (DESIGN.md §19).
    <aside style={{ width: '22rem' }} className="flex shrink-0 flex-col gap-3 overflow-y-auto">
      <PanelCard
        label="Trip"
        trailing={aiEnabled ? 'Agent on' : 'Human only'}
        trailingTint={aiEnabled}
      >
        <div className="text-sm font-medium text-[color:var(--ink)]">{trip.title}</div>
        {trip.intent?.purpose ? (
          <div className="mt-1 text-xs text-muted-foreground">{trip.intent.purpose}</div>
        ) : null}
      </PanelCard>
      {hasTraveler ? (
        <PanelCard label="Traveler">
          <div className="text-sm text-[color:var(--ink)]">
            {trip.traveler?.name ?? travelerSub}
          </div>
          {trip.traveler?.name && travelerSub ? (
            <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{travelerSub}</div>
          ) : null}
        </PanelCard>
      ) : null}
      {trip.booking?.pnr ? (
        <PanelCard label="PNR">
          <div className="text-sm text-[color:var(--ink)]">{trip.booking.pnr}</div>
          {trip.booking.totalAmount ? (
            <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
              {trip.booking.totalAmount} {trip.booking.totalCurrency ?? ''}
            </div>
          ) : null}
        </PanelCard>
      ) : null}
      {hasChannels ? (
        <PanelCard label="Channels">
          <div className="text-sm text-[color:var(--ink)]">{trip.channels.join(' · ')}</div>
        </PanelCard>
      ) : null}
    </aside>
  );
}

function PanelCard({
  label,
  trailing,
  trailingTint,
  children,
}: {
  label: string;
  trailing?: string;
  trailingTint?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[var(--radius-lg)] bg-[color:var(--surface-raised)] px-4 py-4 shadow-[var(--shadow-md)]">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground opacity-60">
          {label}
        </span>
        {trailing ? (
          <span
            className={
              'rounded-full px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.12em] ' +
              (trailingTint
                ? 'bg-[color:var(--tint-vermillion-soft)] text-[color:var(--ink)]'
                : 'text-muted-foreground')
            }
          >
            {trailing}
          </span>
        ) : null}
      </div>
      <div className="mt-2">{children}</div>
    </div>
  );
}
