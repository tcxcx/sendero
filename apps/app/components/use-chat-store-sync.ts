'use client';

/**
 * Shared "useChat → useSendero" dispatch.
 *
 * Maps every tool call streaming through `useChat` (search_flights,
 * book_flight, search_hotels, check_treasury, swap/send/bridge…) into
 * the SenderoApp zustand store so:
 *
 *   - Stage renders the right artifact (offer cards / hold card /
 *     hotel cards / settlement panel)
 *   - WorkflowLog ticks active → done with the per-tool labels
 *   - FooterRail balances refresh after treasury-mutating tools
 *
 * Used by both ChatCol (the `/` shell) and the MetaInbox dashboard
 * console so the booking flow renders identically across surfaces.
 */

import { useEffect, useRef } from 'react';

import { refreshTreasury } from './actions';
import { useSendero } from './store';

type ToolPart = {
  type?: string;
  text?: string;
  state?: string;
  input?: any;
  output?: any;
  result?: any;
  toolCallId?: string;
  toolName?: string;
  toolInvocation?: {
    toolCallId?: string;
    toolName?: string;
    state?: string;
    input?: any;
    result?: any;
  };
};

type ChatMessage = {
  id: string;
  parts?: ToolPart[];
  role: 'assistant' | 'system' | 'user';
};

const clock = () => new Date().toTimeString().slice(0, 8);

export function useChatStoreSync(messages: readonly unknown[]) {
  const startedToolIds = useRef<Set<string>>(new Set());
  const doneToolIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    const s = useSendero.getState();
    for (const m of messages as ChatMessage[]) {
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
        if (!toolName) continue;

        const state = p.state || p.toolInvocation?.state;
        const toolInput = (p.input || p.toolInvocation?.input || {}) as any;
        const output = p.output || p.result || p.toolInvocation?.result;

        const hasInput =
          state === 'input-available' || state === 'output-available' || state === 'result';
        const hasOutput =
          (state === 'output-available' || state === 'result') &&
          output &&
          typeof output === 'object';

        // ── START: pre-output side effects ───────────────────────────
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
          } else {
            // Generic tick so any uncovered tool still surfaces in the
            // workflow log without a per-tool case.
            s.logEvent({
              group: toolName,
              bullet: 'active',
              text: `${toolName}(…)`,
              t: clock(),
            });
          }
        }

        // ── DONE: result landed ──────────────────────────────────────
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
            refreshTreasury();
            s.updateLastEvent('treasury', { bullet: 'done' });
            s.logEvent({
              group: 'treasury',
              bullet: 'done',
              text: `<span class="v">${output.balances.length} tokens</span> read`,
              t: clock(),
            });
          } else if (
            (toolName === 'swap_tokens' ||
              toolName === 'send_tokens' ||
              toolName === 'bridge_to_arc' ||
              toolName === 'swap_and_bridge') &&
            (output.txHash || output.state)
          ) {
            refreshTreasury();
            const group =
              toolName === 'swap_tokens'
                ? 'treasury.swap'
                : toolName === 'send_tokens'
                  ? 'treasury.send'
                  : toolName === 'bridge_to_arc'
                    ? 'treasury.bridge'
                    : 'treasury.swap-bridge';
            s.updateLastEvent(group, { bullet: 'done' });
            s.logEvent({
              group,
              bullet: 'done',
              text: output.txHash
                ? `${toolName} landed · <span class="v">${String(output.txHash).slice(0, 10)}…</span>`
                : `${toolName} ${output.state}`,
              t: clock(),
            });
          } else {
            // Generic done tick for tools without specific data binding.
            s.updateLastEvent(toolName, { bullet: 'done' });
          }
        }
      }
    }
  }, [messages]);
}
