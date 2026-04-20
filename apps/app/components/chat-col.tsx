'use client';

/**
 * ChatCol — live AI agent conversation.
 *
 * Uses @ai-sdk/react's useChat() pointed at /api/chat via DefaultChatTransport.
 * The agent has tool calls for searchFlights / holdFlight / payBooking /
 * checkTreasury. Tool results render inline as subtle cards.
 */

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useEffect, useRef, useState } from 'react';
import { useSendero, runtimeContext } from './store';
import { refreshTreasury } from './actions';

function clock() {
  return new Date().toTimeString().slice(0, 8);
}

export function ChatCol() {
  const traveler = useSendero(s => s.traveler);
  const userAuth = useSendero(s => s.userAuth);

  // Send the signed-in traveler alongside every chat request so server-side
  // tools (book_flight) can authoritatively fill passenger name + email +
  // phone without the LLM having to guess.
  const { messages, sendMessage, status, error } = useChat({
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
        context: runtimeContext(),
      }),
    }) as any,
  });

  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const startedToolIds = useRef<Set<string>>(new Set());
  const doneToolIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Every tool call the agent makes drives the store so that Stage,
  // StepRail, WorkflowLog, FooterRail and AgentCard all move in lockstep
  // with the chat — not just the chat bubble.
  useEffect(() => {
    const s = useSendero.getState();

    for (const m of messages) {
      const parts = (m as any).parts || [];
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
          }
        }
      }
    }
  }, [messages]);

  const isStreaming = status === 'streaming' || status === 'submitted';

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;
    sendMessage({ text: input.trim() } as any);
    setInput('');
  };

  return (
    <div className="chat col">
      <div className="col-head">
        <span className="title">Chat</span>
        <span className="tag faint">
          <span className="dot" style={{ background: 'var(--accent-green)' }} />
          {isStreaming ? 'streaming' : 'live'}
        </span>
      </div>

      <div className="chat-body" ref={scrollRef}>
        {messages.length === 0 && (
          <AgentWelcome
            traveler={traveler.name}
            onSuggest={text => {
              sendMessage({ text } as any);
            }}
          />
        )}

        {messages.map(m => (
          <MessageView
            key={m.id}
            role={m.role === 'user' ? 'human' : 'agent'}
            who={m.role === 'user' ? traveler.name : 'Sendero'}
            initials={m.role === 'user' ? traveler.initials : 'PS'}
            message={m}
          />
        ))}

        {isStreaming && (
          <div className="msg agent">
            <div className="msg-avatar agent">PS</div>
            <div className="msg-body">
              <div className="msg-meta">
                <span className="who">Sendero</span>
                <span>·</span>
                <span>now</span>
                <span style={{ color: 'var(--ink)' }}>agent</span>
              </div>
              <div className="typing">
                <span />
                <span />
                <span />
              </div>
            </div>
          </div>
        )}

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
      </div>

      <div className="composer">
        <form onSubmit={submit} className="composer-input">
          <textarea
            placeholder={`Ask Sendero to book a trip…`}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit(e as any);
              }
            }}
            rows={2}
          />
          <div className="composer-toolbar">
            <div className="composer-tools">
              <button
                type="button"
                className="composer-tool"
                onClick={() => setInput('Book me SFO → LHR on May 4, premium economy, 1 pax.')}
              >
                ✈ SFO→LHR example
              </button>
              <button
                type="button"
                className="composer-tool"
                onClick={() => setInput('What is our treasury balance?')}
              >
                ⊙ Treasury
              </button>
            </div>
            <button type="submit" className="composer-send" disabled={isStreaming || !input.trim()}>
              Send ⏎
            </button>
          </div>
        </form>
      </div>
    </div>
  );
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
          Hi {traveler.split(' ')[0]}. I can search flights, hold a seat on Duffel, and settle in
          USDC or EURC on Arc L2. Where to?
        </div>
        <div className="msg-suggestions">
          <button
            className="suggestion"
            onClick={() => onSuggest('Book SFO → LHR on May 4, premium economy, 1 passenger.')}
          >
            Business trip SFO → LHR
          </button>
          <button
            className="suggestion"
            onClick={() => onSuggest('Find me a flight BOS → CDG on June 11, economy.')}
          >
            Conference Paris
          </button>
          <button className="suggestion" onClick={() => onSuggest('Check our treasury balance.')}>
            Check treasury
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageView({
  role,
  who,
  initials,
  message,
}: {
  role: 'human' | 'agent';
  who: string;
  initials: string;
  message: any;
}) {
  const parts = message.parts || [];
  const textContent = parts
    .filter((p: any) => p.type === 'text')
    .map((p: any) => p.text)
    .join('');

  const toolCalls = parts.filter(
    (p: any) =>
      p.type === 'tool-invocation' || (typeof p.type === 'string' && p.type.startsWith('tool-'))
  );

  return (
    <div className={`msg ${role}`}>
      <div className={`msg-avatar ${role}`}>{initials}</div>
      <div className="msg-body">
        <div className="msg-meta">
          <span className="who">{who}</span>
          <span>·</span>
          <span>now</span>
          {role === 'agent' && <span style={{ color: 'var(--ink)' }}>agent</span>}
        </div>
        {textContent && <div className="msg-text">{textContent}</div>}
        {toolCalls.map((p: any, i: number) => (
          <ToolCallCard key={i} part={p} />
        ))}
      </div>
    </div>
  );
}

function ToolCallCard({ part }: { part: any }) {
  const toolName =
    part.toolName ||
    part.toolInvocation?.toolName ||
    (typeof part.type === 'string' ? part.type.replace('tool-', '') : 'tool');
  const state = part.state || part.toolInvocation?.state || 'running';
  const result = part.output || part.result || part.toolInvocation?.result;

  const label = toolName?.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase());

  return (
    <div className="msg-inline-card">
      <div className="row">
        <span className="k">Tool</span>
        <span className="v">{label || '—'}</span>
      </div>
      <div className="row">
        <span className="k">State</span>
        <span className="v">{state}</span>
      </div>
      {result && typeof result === 'object' && (
        <div style={{ marginTop: 6, fontSize: 10, color: 'var(--text-dim)' }}>
          {Object.entries(result)
            .slice(0, 4)
            .map(([k, v]) => (
              <div className="row" key={k}>
                <span className="k">{k}</span>
                <span className="v">{formatValue(v)}</span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

function formatValue(v: unknown): string {
  if (Array.isArray(v)) return `${v.length} items`;
  if (v && typeof v === 'object') return JSON.stringify(v).slice(0, 48) + '…';
  return String(v);
}
