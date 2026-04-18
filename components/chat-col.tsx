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
import { usePasillo } from './store';

export function ChatCol() {
  const traveler = usePasillo((s) => s.traveler);
  const setOnChainSettlement = usePasillo((s) => s.setOnChainSettlement);
  const setHoldOrder = usePasillo((s) => s.setHoldOrder);
  const setPayment = usePasillo((s) => s.setPayment);
  const setHotels = usePasillo((s) => s.setHotels);
  const logEvent = usePasillo((s) => s.logEvent);

  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({ api: '/api/chat' }) as any,
  });

  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const processedToolIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Watch chat messages for tool results and pipe them into the store so the
  // Stage (SettlementCard, HoldCard) reflects the live state.
  useEffect(() => {
    for (const m of messages) {
      const parts = (m as any).parts || [];
      for (const p of parts) {
        const toolCallId = p.toolCallId || p.toolInvocation?.toolCallId;
        if (!toolCallId || processedToolIds.current.has(toolCallId)) continue;

        const toolName =
          p.toolName ||
          p.toolInvocation?.toolName ||
          (typeof p.type === 'string' && p.type.startsWith('tool-')
            ? p.type.replace('tool-', '')
            : null);
        const state = p.state || p.toolInvocation?.state;
        const output = p.output || p.result || p.toolInvocation?.result;

        if (state !== 'output-available' && state !== 'result') continue;
        if (!output || typeof output !== 'object') continue;

        if (toolName === 'book_flight' && output.orderId && output.pnr) {
          processedToolIds.current.add(toolCallId);
          setHoldOrder({
            orderId: output.orderId,
            bookingReference: output.pnr,
            totalAmount: output.totalAmount,
            totalCurrency: output.totalCurrency,
            paymentRequiredBy: new Date(Date.now() + 20 * 60_000).toISOString(),
            demo: !!output.demo,
          });
          setPayment({
            paymentId: output.orderId,
            status: output.paymentStatus || 'succeeded',
            amount: output.totalAmount,
            currency: output.totalCurrency,
            demo: !!output.demo,
          });
          logEvent({
            group: 'book.flight',
            bullet: 'done',
            text: `PNR <span class="v">${output.pnr}</span> issued`,
            t: new Date().toTimeString().slice(0, 8),
          });
        }

        if (toolName === 'search_hotels' && output.hotels) {
          processedToolIds.current.add(toolCallId);
          // Pull params from the corresponding tool-call part when available
          const input = (p.input || p.toolInvocation?.input || {}) as any;
          setHotels(
            {
              location: input.location ?? 'Unknown',
              checkInDate: input.checkInDate ?? '',
              checkOutDate: input.checkOutDate ?? '',
              guests: input.guests ?? 1,
              rooms: input.rooms ?? 1,
            },
            output.hotels,
          );
          logEvent({
            group: 'search.hotels',
            bullet: 'done',
            text: `<span class="v">${output.hotels.length} properties</span> in ${input.location ?? '—'}`,
            t: new Date().toTimeString().slice(0, 8),
          });
        }

        if (toolName === 'settle_on_arc' && output.txHashes) {
          processedToolIds.current.add(toolCallId);
          setOnChainSettlement({
            jobId: output.jobId,
            pnr: output.pnr || '',
            deliverableHash: output.deliverableHash || '',
            txHashes: output.txHashes,
            explorerBase:
              output.explorerBase || 'https://testnet.arcscan.app',
            completedAt: Date.now(),
            demo: !!output.demo,
          });
          logEvent({
            group: 'settle.arc',
            bullet: 'done',
            text: `<span class="v">${output.txHashes.length} txs</span> landed on Arc · job <span class="v">#${output.jobId}</span>`,
            t: new Date().toTimeString().slice(0, 8),
          });
        }
      }
    }
  }, [messages, setOnChainSettlement, setHoldOrder, setPayment, setHotels, logEvent]);

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
            onSuggest={(text) => {
              sendMessage({ text } as any);
            }}
          />
        )}

        {messages.map((m) => (
          <MessageView
            key={m.id}
            role={m.role === 'user' ? 'human' : 'agent'}
            who={m.role === 'user' ? traveler.name : 'Pasillo'}
            initials={m.role === 'user' ? traveler.initials : 'PS'}
            message={m}
          />
        ))}

        {isStreaming && (
          <div className="msg agent">
            <div className="msg-avatar agent">PS</div>
            <div className="msg-body">
              <div className="msg-meta">
                <span className="who">Pasillo</span>
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
            placeholder={`Ask Pasillo to book a trip…`}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
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
                onClick={() =>
                  setInput(
                    'Book me SFO → LHR on May 4, premium economy, 1 pax.',
                  )
                }
              >
                ✈ SFO→LHR demo
              </button>
              <button
                type="button"
                className="composer-tool"
                onClick={() => setInput('What is our treasury balance?')}
              >
                ⊙ Treasury
              </button>
            </div>
            <button
              type="submit"
              className="composer-send"
              disabled={isStreaming || !input.trim()}
            >
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
          <span className="who">Pasillo</span>
          <span>·</span>
          <span>ready</span>
          <span style={{ color: 'var(--ink)' }}>agent</span>
        </div>
        <div className="msg-text">
          Hi {traveler.split(' ')[0]}. I can search flights, hold a seat on
          Duffel, and settle in USDC or EURC on Arc L2. Where to?
        </div>
        <div className="msg-suggestions">
          <button
            className="suggestion"
            onClick={() =>
              onSuggest(
                'Book SFO → LHR on May 4, premium economy, 1 passenger.',
              )
            }
          >
            Business trip SFO → LHR
          </button>
          <button
            className="suggestion"
            onClick={() =>
              onSuggest('Find me a flight BOS → CDG on June 11, economy.')
            }
          >
            Conference Paris
          </button>
          <button
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
      p.type === 'tool-invocation' || (typeof p.type === 'string' && p.type.startsWith('tool-')),
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
