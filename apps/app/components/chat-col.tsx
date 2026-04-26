'use client';

/**
 * ChatCol — live AI agent conversation.
 *
 * Uses @ai-sdk/react's useChat() pointed at /api/chat via DefaultChatTransport.
 * The agent has tool calls for searchFlights / holdFlight / payBooking /
 * checkTreasury. Tool results render inline as subtle cards.
 */

import { useEffect, useRef, useState } from 'react';

import { useChat } from '@ai-sdk/react';
import { detectLocale, LOCALE_COOKIE_NAME } from '@sendero/locale';
import { DefaultChatTransport } from 'ai';
import { ExternalLinkIcon, MapIcon, UtensilsCrossedIcon } from 'lucide-react';

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message';
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from '@/components/ai-elements/prompt-input';
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning';
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from '@/components/ai-elements/tool';

import { refreshTreasury } from './actions';
import { runtimeContext, useSendero } from './store';
import { TripToolCard } from './trip-tool-cards';

function clock() {
  return new Date().toTimeString().slice(0, 8);
}

type SenderoToolPart = {
  errorText?: string;
  input?: any;
  output?: any;
  reasoning?: string;
  result?: any;
  state?: string;
  status?: string;
  text?: string;
  toolCallId?: string;
  toolInvocation?: {
    errorText?: string;
    input?: any;
    result?: any;
    state?: string;
    toolCallId?: string;
    toolName?: string;
  };
  toolName?: string;
  type?: string;
};

type SenderoChatMessage = {
  id: string;
  parts?: SenderoToolPart[];
  role: 'assistant' | 'system' | 'user';
};

export function ChatCol() {
  const traveler = useSendero(s => s.traveler);
  const userAuth = useSendero(s => s.userAuth);
  const [locale, setLocale] = useState('en-US');

  useEffect(() => {
    setLocale(readClientLocale());
  }, []);

  // Send the signed-in traveler alongside every chat request so server-side
  // tools (book_flight) can authoritatively fill passenger name + email +
  // phone without the LLM having to guess.
  const { messages, sendMessage, status, error, stop } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/chat',
      body: () => ({
        traveler: {
          name: traveler.name,
          email: traveler.email,
          phone: userAuth?.phone ?? '',
        },
        // Live snapshot of the booking state + last errors so the agent can
        // see what's happening in the UI and respond to failures.
        context: { ...runtimeContext(), locale },
        locale,
      }),
    }),
  });
  const startedToolIds = useRef<Set<string>>(new Set());
  const doneToolIds = useRef<Set<string>>(new Set());

  // Every tool call the agent makes drives the store so that Stage,
  // StepRail, WorkflowLog, FooterRail and AgentCard all move in lockstep
  // with the chat — not just the chat bubble.
  useEffect(() => {
    const s = useSendero.getState();

    for (const m of messages as SenderoChatMessage[]) {
      const parts = m.parts || [];
      for (const p of parts) {
        const toolCallId = p.toolCallId || p.toolInvocation?.toolCallId;
        if (!toolCallId) continue;

        const toolName =
          p.toolName ||
          p.toolInvocation?.toolName ||
          (typeof p.type === 'string' && p.type.startsWith('tool-')
            ? p.type.replace('tool-', '')
            : null);
        const state = p.state || p.toolInvocation?.state;
        const toolInput = (p.input || p.toolInvocation?.input || {}) as any;
        const output = p.output || p.result || p.toolInvocation?.result;

        const hasInput =
          state === 'input-available' || state === 'output-available' || state === 'result';
        const hasOutput =
          (state === 'output-available' || state === 'result') &&
          output &&
          typeof output === 'object';

        // ── START: pre-output side effects (status + active log) ─────────
        if (hasInput && !startedToolIds.current.has(toolCallId)) {
          startedToolIds.current.add(toolCallId);

          if (toolName === 'search_flights' && toolInput.origin) {
            s.setSearch({
              origin: toolInput.origin,
              destination: toolInput.destination,
              departureDate: toolInput.departureDate,
              returnDate: toolInput.returnDate,
              passengers: toolInput.passengers ?? 1,
              cabinClass: toolInput.cabinClass ?? 'economy',
            });
            s.logEvent({
              group: 'search.flights',
              bullet: 'active',
              text: `parseTrip(<span class="v">${toolInput.origin} → ${toolInput.destination}</span>)`,
              t: clock(),
            });
          } else if (toolName === 'book_flight') {
            s.setStatus('holding');
            s.logEvent({
              group: 'book.flight',
              bullet: 'active',
              text: `holdInventory(<span class="v">${(toolInput.offerId ?? '').slice(0, 10) || '—'}</span>)`,
              t: clock(),
            });
          } else if (toolName === 'search_hotels') {
            s.logEvent({
              group: 'search.hotels',
              bullet: 'active',
              text: `stays.search(<span class="v">${toolInput.location ?? '—'}</span>)`,
              t: clock(),
            });
          } else if (toolName === 'check_treasury') {
            s.logEvent({
              group: 'treasury',
              bullet: 'active',
              text: 'readBalances(USDC, EURC)',
              t: clock(),
            });
          } else if (toolName === 'swap_tokens') {
            s.logEvent({
              group: 'treasury.swap',
              bullet: 'active',
              text: `swap(<span class="v">${toolInput.amount} ${toolInput.fromToken} → ${toolInput.toToken}</span>)`,
              t: clock(),
            });
          } else if (toolName === 'send_tokens') {
            s.logEvent({
              group: 'treasury.send',
              bullet: 'active',
              text: `send(<span class="v">${toolInput.amount} ${toolInput.token ?? 'USDC'}</span> → ${(toolInput.to ?? '').slice(0, 10)}…)`,
              t: clock(),
            });
          } else if (toolName === 'bridge_to_arc') {
            s.logEvent({
              group: 'treasury.bridge',
              bullet: 'active',
              text: `bridge(<span class="v">${toolInput.amount} USDC</span> · ${toolInput.fromChain} → Arc)`,
              t: clock(),
            });
          } else if (toolName === 'swap_and_bridge') {
            s.logEvent({
              group: 'treasury.swap-bridge',
              bullet: 'active',
              text: `bridge+swap(<span class="v">${toolInput.amount} USDC</span> · ${toolInput.fromChain} → Arc → ${toolInput.targetToken ?? 'EURC'})`,
              t: clock(),
            });
          } else if (toolName === 'restaurant_route_card') {
            s.logEvent({
              group: 'concierge.restaurants',
              bullet: 'active',
              text: `shortlist(<span class="v">${toolInput.cuisine ?? 'restaurants'} · ${toolInput.location ?? '—'}</span>)`,
              t: clock(),
            });
          } else if (toolName === 'airport_transfer_coordinator') {
            s.logEvent({
              group: 'arrival.transfer',
              bullet: 'active',
              text: `plan(<span class="v">${toolInput.airport ?? '—'} → ${toolInput.destinationLabel ?? toolInput.destinationAddress ?? 'dest'}</span>)`,
              t: clock(),
            });
          } else if (toolName === 'airport_arrival_playbook') {
            s.logEvent({
              group: 'arrival.playbook',
              bullet: 'active',
              text: `playbook(<span class="v">${toolInput.airport ?? '—'}</span>)`,
              t: clock(),
            });
          } else if (toolName === 'trip_checkin_reminder') {
            s.logEvent({
              group: 'trip.checkin',
              bullet: 'active',
              text: `reminder(<span class="v">${toolInput.origin ?? '—'}${toolInput.destination ? ` → ${toolInput.destination}` : ''}</span>)`,
              t: clock(),
            });
          } else if (toolName === 'trip_delay_replanner') {
            const leg = toolInput.originalLeg ?? {};
            s.logEvent({
              group: 'trip.delay',
              bullet: 'active',
              text: `replan(<span class="v">${leg.origin ?? '—'} → ${leg.destination ?? '—'}</span> · ${toolInput.disruption?.kind ?? 'disruption'})`,
              t: clock(),
            });
          } else if (toolName === 'scan_document') {
            s.logEvent({
              group: 'ocr.scan',
              bullet: 'active',
              text: `extract(<span class="v">${toolInput.kind ?? 'document'}</span>)`,
              t: clock(),
            });
          }
        }

        // ── DONE: result landed ─────────────────────────────────────────
        if (hasOutput && !doneToolIds.current.has(toolCallId)) {
          doneToolIds.current.add(toolCallId);

          if (toolName === 'search_flights' && output.offers) {
            s.setOffers(output.offers);
            s.updateLastEvent('search.flights', { bullet: 'done' });
            s.logEvent({
              group: 'search.flights',
              bullet: 'done',
              text: `rankFares(<span class="v">${output.offers.length} offers</span>)`,
              t: clock(),
            });
          } else if (toolName === 'book_flight' && output.orderId && output.pnr) {
            s.setHoldOrder({
              orderId: output.orderId,
              bookingReference: output.pnr,
              totalAmount: output.totalAmount,
              totalCurrency: output.totalCurrency,
              paymentRequiredBy: new Date(Date.now() + 20 * 60_000).toISOString(),
              demo: !!output.demo,
            });
            s.setPayment({
              paymentId: output.orderId,
              status: output.paymentStatus || 'succeeded',
              amount: output.totalAmount,
              currency: output.totalCurrency,
              demo: !!output.demo,
            });
            s.updateLastEvent('book.flight', { bullet: 'done' });
            s.logEvent({
              group: 'book.flight',
              bullet: 'done',
              text: `PNR <span class="v">${output.pnr}</span> issued · ${output.totalAmount} ${output.totalCurrency}`,
              t: clock(),
            });
          } else if (toolName === 'search_hotels' && output.hotels) {
            s.setHotels(
              {
                location: toolInput.location ?? 'Unknown',
                checkInDate: toolInput.checkInDate ?? '',
                checkOutDate: toolInput.checkOutDate ?? '',
                guests: toolInput.guests ?? 1,
                rooms: toolInput.rooms ?? 1,
              },
              output.hotels
            );
            s.updateLastEvent('search.hotels', { bullet: 'done' });
            s.logEvent({
              group: 'search.hotels',
              bullet: 'done',
              text: `<span class="v">${output.hotels.length} properties</span> in ${toolInput.location ?? '—'}`,
              t: clock(),
            });
          } else if (toolName === 'check_treasury' && output.balances) {
            // The chat tool returns balances only; refreshTreasury() pulls the
            // full snapshot (balances + arc status + addr) so the footer is
            // consistent with the 20s poll.
            refreshTreasury();
            s.updateLastEvent('treasury', { bullet: 'done' });
            s.logEvent({
              group: 'treasury',
              bullet: 'done',
              text: `<span class="v">${output.balances.length} tokens</span> read`,
              t: clock(),
            });
          } else if (toolName === 'swap_tokens' && (output.txHash || output.state)) {
            refreshTreasury();
            s.updateLastEvent('treasury.swap', { bullet: 'done' });
            s.logEvent({
              group: 'treasury.swap',
              bullet: 'done',
              text: output.txHash
                ? `swap landed · <span class="v">${output.txHash.slice(0, 10)}…</span>`
                : `swap ${output.state}`,
              t: clock(),
            });
          } else if (toolName === 'send_tokens' && (output.txHash || output.state)) {
            refreshTreasury();
            s.updateLastEvent('treasury.send', { bullet: 'done' });
            s.logEvent({
              group: 'treasury.send',
              bullet: 'done',
              text: output.txHash
                ? `send landed · <span class="v">${output.txHash.slice(0, 10)}…</span>`
                : `send ${output.state}`,
              t: clock(),
            });
          } else if (toolName === 'bridge_to_arc' && (output.txHash || output.state)) {
            refreshTreasury();
            s.updateLastEvent('treasury.bridge', { bullet: 'done' });
            s.logEvent({
              group: 'treasury.bridge',
              bullet: 'done',
              text: output.txHash
                ? `bridge landed · <span class="v">${output.txHash.slice(0, 10)}…</span>`
                : `bridge ${output.state}`,
              t: clock(),
            });
          } else if (toolName === 'swap_and_bridge' && (output.txHash || output.state)) {
            refreshTreasury();
            s.updateLastEvent('treasury.swap-bridge', { bullet: 'done' });
            s.logEvent({
              group: 'treasury.swap-bridge',
              bullet: 'done',
              text: output.txHash
                ? `bridge+swap landed · <span class="v">${output.txHash.slice(0, 10)}…</span>`
                : `bridge+swap ${output.state}`,
              t: clock(),
            });
          } else if (toolName === 'restaurant_route_card' && output.topPick) {
            s.updateLastEvent('concierge.restaurants', { bullet: 'done' });
            s.logEvent({
              group: 'concierge.restaurants',
              bullet: 'done',
              text: `pick <span class="v">${output.topPick.name}</span>${output.routeLinks ? ' · route ready' : ''}`,
              t: clock(),
            });
          } else if (toolName === 'airport_transfer_coordinator' && output.pickupPlan) {
            s.updateLastEvent('arrival.transfer', { bullet: 'done' });
            s.logEvent({
              group: 'arrival.transfer',
              bullet: 'done',
              text: `meet <span class="v">${output.pickupPlan.meetingPoint}</span>${output.safety?.riskLevel ? ` · risk ${output.safety.riskLevel}` : ''}`,
              t: clock(),
            });
          } else if (
            toolName === 'airport_arrival_playbook' &&
            Array.isArray(output.arrivalSteps)
          ) {
            s.updateLastEvent('arrival.playbook', { bullet: 'done' });
            s.logEvent({
              group: 'arrival.playbook',
              bullet: 'done',
              text: `<span class="v">${output.arrivalSteps.length} steps</span> ready`,
              t: clock(),
            });
          } else if (toolName === 'trip_checkin_reminder' && output.nextAction) {
            s.updateLastEvent('trip.checkin', { bullet: 'done' });
            s.logEvent({
              group: 'trip.checkin',
              bullet: 'done',
              text: `next · <span class="v">${output.nextAction.label}</span>`,
              t: clock(),
            });
          } else if (toolName === 'trip_delay_replanner' && output.rebookOptions) {
            s.updateLastEvent('trip.delay', { bullet: output.recommendedRebook ? 'done' : 'fail' });
            s.logEvent({
              group: 'trip.delay',
              bullet: output.recommendedRebook ? 'done' : 'fail',
              text: output.recommendedRebook
                ? `rebook · <span class="v">${output.recommendedRebook.segmentsSummary}</span>`
                : 'no self-serve rebook · agent handoff',
              t: clock(),
            });
          } else if (toolName === 'scan_document' && output) {
            const extracted = (output.data ?? {}) as Record<string, unknown>;
            const kind = output.kind ?? toolInput.kind ?? 'document';
            const summary =
              kind === 'boarding_pass'
                ? `${extracted.origin_iata ?? '—'} → ${extracted.destination_iata ?? '—'} · PNR ${extracted.pnr ?? '—'}`
                : kind === 'invoice'
                  ? `${extracted.vendor_name ?? 'Invoice'} · ${extracted.total_amount ?? '—'} ${extracted.currency ?? ''}`
                  : `${extracted.store_name ?? 'Receipt'} · ${extracted.total_amount ?? '—'} ${extracted.currency ?? ''}`;
            s.updateLastEvent('ocr.scan', { bullet: 'done' });
            s.logEvent({
              group: 'ocr.scan',
              bullet: 'done',
              text: `<span class="v">${summary}</span> · ${output.latencyMs ?? '?'}ms`,
              t: clock(),
            });
          }
        }
      }
    }
  }, [messages]);

  const isStreaming = status === 'streaming' || status === 'submitted';

  return (
    <div className="chat col">
      <div className="col-head">
        <span className="title">Chat</span>
        <span className="tag faint">
          <span className="dot" style={{ background: 'var(--accent-green)' }} />
          {isStreaming ? 'streaming' : 'live'}
        </span>
      </div>

      <div className="chat-body">
        <Conversation className="h-full">
          <ConversationContent className="gap-6 px-5 py-4">
            {messages.length === 0 && (
              <AgentWelcome
                traveler={traveler.name}
                onSuggest={text => {
                  sendMessage({ text });
                }}
              />
            )}

            {messages.map(m => (
              <MessageView
                key={m.id}
                initials={m.role === 'user' ? traveler.initials : 'PS'}
                message={m as SenderoChatMessage}
                who={m.role === 'user' ? traveler.name : 'Sendero'}
              />
            ))}

            {error && (
              <div className="msg agent">
                <div className="msg-avatar agent">!</div>
                <div className="msg-body">
                  <div className="msg-meta">
                    <span className="who">System</span>
                  </div>
                  <div className="msg-text" style={{ color: 'var(--accent-rose)' }}>
                    {error.message}
                  </div>
                </div>
              </div>
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      </div>

      <div className="composer rounded-lg border border-[color:var(--border)]">
        <PromptInput
          className="composer-input rounded-lg border-[color:var(--border)] bg-[color:var(--panel)]"
          onSubmit={(message, event) => {
            event.preventDefault();
            const next = message.text.trim();
            const files = message.files ?? [];
            if (!next && files.length === 0) return;
            if (isStreaming) return;
            // `files` flows through @ai-sdk/react's useChat into the chat
            // route, where convertToModelMessages() maps FileUIParts to
            // the multimodal content array Gemini expects.
            sendMessage({ text: next, files });
          }}
        >
          <PromptInputBody>
            <PromptInputTextarea placeholder="Ask Sendero to book a trip…" />
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputTools>
              <button
                type="button"
                className="composer-tool"
                onClick={() =>
                  sendMessage({
                    text: 'Search premium economy flights SFO → LHR, departing 2026-05-08 and returning 2026-05-15, for 1 passenger.',
                  })
                }
              >
                ✈ SFO→LHR example
              </button>
              <button
                type="button"
                className="composer-tool"
                onClick={() => sendMessage({ text: 'What is our treasury balance?' })}
              >
                ⊙ Treasury
              </button>
            </PromptInputTools>
            <PromptInputSubmit className="composer-send" onStop={stop} status={status} />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
}

function readClientLocale(): string {
  const cookieLocale =
    typeof document === 'undefined'
      ? null
      : document.cookie
          .split(';')
          .map(part => part.trim())
          .find(part => part.startsWith(`${LOCALE_COOKIE_NAME}=`))
          ?.split('=')[1];

  return detectLocale({
    cookie: cookieLocale ? decodeURIComponent(cookieLocale) : null,
    acceptLanguage:
      typeof navigator === 'undefined'
        ? null
        : navigator.languages?.join(',') || navigator.language,
    country: null,
  });
}

function AgentWelcome({
  traveler,
  onSuggest,
}: {
  traveler: string;
  onSuggest: (text: string) => void;
}) {
  return (
    <div className="msg agent">
      <div className="msg-avatar agent">PS</div>
      <div className="msg-body">
        <div className="msg-meta">
          <span className="who">Sendero</span>
          <span>·</span>
          <span>ready</span>
          <span style={{ color: 'var(--ink)' }}>agent</span>
        </div>
        <div className="msg-text">
          Hi {traveler.split(' ')[0]}. I can search flights, hold the seat, and settle in USDC or
          EURC on Arc L2. Where to?
        </div>
        <div className="msg-suggestions">
          <button
            type="button"
            className="suggestion"
            onClick={() =>
              onSuggest(
                'Search premium economy flights SFO → LHR, departing 2026-05-08 and returning 2026-05-15, for 1 passenger.'
              )
            }
          >
            Business trip SFO → LHR
          </button>
          <button
            type="button"
            className="suggestion"
            onClick={() => onSuggest('Find me a flight BOS → CDG on June 11, economy.')}
          >
            Conference Paris
          </button>
          <button
            type="button"
            className="suggestion"
            onClick={() => onSuggest('Check our treasury balance.')}
          >
            Check treasury
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageView({
  who,
  initials,
  message,
}: {
  who: string;
  initials: string;
  message: SenderoChatMessage;
}) {
  const parts = message.parts || [];
  const textContent = parts
    .filter(p => p.type === 'text')
    .map(p => p.text)
    .join('');

  const toolCalls = parts.filter(
    p => p.type === 'tool-invocation' || (typeof p.type === 'string' && p.type.startsWith('tool-'))
  );
  const reasoningParts = parts.filter(p => p.type === 'reasoning');
  const isUser = message.role === 'user';

  return (
    <div className={`msg ${isUser ? 'human' : 'agent'}`}>
      <div className={`msg-avatar ${isUser ? 'human' : 'agent'}`}>{initials}</div>
      <Message className="msg-body max-w-none gap-3" from={message.role}>
        <div className="msg-meta">
          <span className="who">{who}</span>
          <span>·</span>
          <span>now</span>
          {!isUser && <span style={{ color: 'var(--ink)' }}>agent</span>}
        </div>
        <MessageContent
          className={
            isUser
              ? 'max-w-[85%]'
              : 'max-w-full rounded-[18px] border border-[color:var(--border)] bg-[color:var(--panel)] px-4 py-3'
          }
        >
          {textContent && (
            <MessageResponse className="msg-text text-sm leading-6">{textContent}</MessageResponse>
          )}
          {reasoningParts.map(part => {
            const reasoningText = part.text || part.reasoning || '';
            if (!reasoningText) return null;
            return (
              <Reasoning
                key={reasoningText.slice(0, 64)}
                defaultOpen={false}
                isStreaming={isStreamingReasoning(part)}
              >
                <ReasoningTrigger />
                <ReasoningContent>{reasoningText}</ReasoningContent>
              </Reasoning>
            );
          })}
        </MessageContent>
        {toolCalls.map(p => (
          <ToolCallCard
            key={p.toolCallId || `${p.toolName || p.type}-${p.state || 'idle'}`}
            part={p}
          />
        ))}
      </Message>
    </div>
  );
}

function ToolCallCard({ part }: { part: SenderoToolPart }) {
  const toolName =
    part.toolName ||
    part.toolInvocation?.toolName ||
    (typeof part.type === 'string' ? part.type.replace('tool-', '') : 'tool');
  const state = part.state || part.toolInvocation?.state || 'running';
  const toolState = state as
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

  const label = toolName?.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase());

  return (
    <Tool className="mt-3 overflow-hidden border-[color:var(--border)] bg-[color:var(--bg-soft)]">
      <ToolHeader
        state={toolState}
        title={label || 'Tool'}
        toolName={toolName}
        type="dynamic-tool"
      />
      <ToolContent>
        {input ? <ToolInput input={input} /> : null}
        <ToolPreview result={result} toolName={toolName} />
        <ToolOutput errorText={errorText} output={result} />
      </ToolContent>
    </Tool>
  );
}

const TRIP_TOOL_NAMES = new Set([
  'restaurant_route_card',
  'airport_transfer_coordinator',
  'airport_arrival_playbook',
  'trip_checkin_reminder',
  'trip_delay_replanner',
  'list_flight_ancillaries',
  'find_airports_nearby',
  'display_offer_conditions',
  'quote_stay',
  'cancel_order_quote',
  'confirm_cancel_order',
  'scan_document',
  'trip_weather_brief',
  'air_quality_brief',
  'validate_travel_address',
  'timezone_brief',
  'elevation_risk_brief',
  'travel_safety_aid',
]);

function ToolPreview({ toolName, result }: { toolName: string; result: unknown }) {
  if (!result || typeof result !== 'object') return null;
  if (TRIP_TOOL_NAMES.has(toolName)) {
    return <TripToolCard result={result} toolName={toolName} />;
  }
  const data = result as any;

  if (data.staticMapUrl || data.googleMapsUrl || data.appleMapsUrl) {
    return (
      <div className="grid gap-3">
        {data.staticMapUrl ? (
          <div className="overflow-hidden rounded-xl border border-[color:var(--border)]">
            <img
              alt={data.previewCard?.alt || `${toolName} preview`}
              className="h-40 w-full object-cover"
              src={data.staticMapUrl}
            />
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {data.googleMapsUrl ? (
            <a
              className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-[color:var(--ink)]"
              href={data.googleMapsUrl}
              rel="noreferrer"
              target="_blank"
            >
              <MapIcon className="size-3.5" />
              Google Maps
              <ExternalLinkIcon className="size-3.5" />
            </a>
          ) : null}
          {data.appleMapsUrl ? (
            <a
              className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-[color:var(--ink)]"
              href={data.appleMapsUrl}
              rel="noreferrer"
              target="_blank"
            >
              <MapIcon className="size-3.5" />
              Apple Maps
              <ExternalLinkIcon className="size-3.5" />
            </a>
          ) : null}
        </div>
      </div>
    );
  }

  if (Array.isArray(data.restaurants) && data.restaurants.length > 0) {
    return (
      <div className="grid gap-2">
        {data.restaurants.slice(0, 3).map((restaurant: Record<string, unknown>) => (
          <div
            key={String(restaurant.placeId || restaurant.name)}
            className="rounded-xl border border-[color:var(--border)] bg-[color:var(--panel)] px-3 py-2"
          >
            <div className="flex items-center gap-2 font-medium text-sm text-[color:var(--ink)]">
              <UtensilsCrossedIcon className="size-4" />
              {String(restaurant.name)}
            </div>
            <div className="mt-1 text-xs text-[color:var(--text-dim)]">
              {String(restaurant.shortAddress || restaurant.formattedAddress || 'No address')}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return null;
}

function isStreamingReasoning(part: SenderoToolPart) {
  return part.state === 'streaming' || part.status === 'streaming';
}
