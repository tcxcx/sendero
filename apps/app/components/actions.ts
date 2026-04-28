'use client';

/**
 * Client actions — wrap fetch() calls + update the Zustand store.
 *
 * Each action logs workflow events so the right-side console stays in sync
 * with what's happening on the wire.
 */

import { useSendero, type SearchParams, type FlightOffer } from './store';
import { noteToChat } from './chat-bridge';

function now() {
  const d = new Date();
  return d.toTimeString().slice(0, 8);
}

export async function searchFlights(params: SearchParams) {
  const { setSearch, setOffers, setError, logEvent, updateLastEvent, clearLog } =
    useSendero.getState();

  clearLog();
  setSearch(params);
  setError(null);

  logEvent({
    group: 'search.flights',
    bullet: 'active',
    text: `parseTrip(<span class="v">${params.origin} → ${params.destination}</span>)`,
    t: now(),
  });

  try {
    const res = await fetch('/api/flights/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.message || data?.error || `search_failed (${res.status})`);
    }

    const offers: FlightOffer[] = data.offers || [];
    setOffers(offers);

    updateLastEvent('search.flights', { bullet: 'done' });
    logEvent({
      group: 'search.flights',
      bullet: 'done',
      text: `rankFares(<span class="v">${offers.length} results</span>)`,
      t: now(),
    });

    return offers;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setError(msg);
    updateLastEvent('search.flights', { bullet: 'fail' });
    logEvent({
      group: 'search.flights',
      bullet: 'fail',
      text: `error: ${msg}`,
      t: now(),
    });
    return [];
  }
}

export async function holdFlight(
  offerId: string,
  passenger: { name: string; email: string; phone?: string }
) {
  const { selectOffer, setHoldOrder, setStatus, setError, logEvent } = useSendero.getState();

  selectOffer(offerId);
  setStatus('holding');
  setError(null);

  logEvent({
    group: 'book.hold',
    bullet: 'active',
    text: `holdInventory(<span class="v">offer=${offerId.slice(0, 10)}</span>)`,
    t: now(),
  });

  try {
    const res = await fetch('/api/bookings/hold', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        offerId,
        passengerName: passenger.name,
        passengerEmail: passenger.email,
        passengerPhone: passenger.phone,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.message || data?.error || `hold_failed (${res.status})`);
    }
    setHoldOrder({
      orderId: data.orderId,
      bookingReference: data.bookingReference,
      totalAmount: data.totalAmount,
      totalCurrency: data.totalCurrency,
      paymentRequiredBy: data.paymentRequiredBy,
      demo: data.demo,
    });

    logEvent({
      group: 'book.hold',
      bullet: 'done',
      text: `PNR <span class="v">${data.bookingReference}</span> · ttl=${new Date(data.paymentRequiredBy).toISOString().slice(11, 16)}`,
      t: now(),
    });

    // Append a synthetic note to the active chat so the agent sees the
    // hold on follow-up turns ("what PNR did you hold?") and the note
    // survives reload via chat history rehydrate. Direct API path stays
    // unchanged — no LLM round-trip cost, no auto-pay risk.
    noteToChat(
      `Held offer ${offerId.slice(0, 10)}… → PNR ${data.bookingReference}, ${data.totalAmount} ${data.totalCurrency}, due by ${new Date(data.paymentRequiredBy).toISOString().slice(11, 16)} UTC.`
    );

    return data;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setError(msg);
    logEvent({
      group: 'book.hold',
      bullet: 'fail',
      text: `error: ${msg}`,
      t: now(),
    });
    return null;
  }
}

export async function payBooking(orderId: string) {
  const { setPayment, setStatus, setError, logEvent } = useSendero.getState();
  setStatus('paying');
  setError(null);

  logEvent({
    group: 'settle.arc',
    bullet: 'active',
    text: `payFromBalance(<span class="v">${orderId.slice(0, 10)}</span>)`,
    t: now(),
  });

  try {
    const res = await fetch(`/api/bookings/${encodeURIComponent(orderId)}/pay`, {
      method: 'POST',
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.message || data?.error || `pay_failed (${res.status})`);
    }
    setPayment({
      paymentId: data.paymentId,
      status: data.status,
      amount: data.amount,
      currency: data.currency,
      demo: data.demo,
    });

    logEvent({
      group: 'settle.arc',
      bullet: 'done',
      text: `circleCCTP(<span class="v">${data.amount} ${data.currency}</span>) → Arc L2`,
      t: now(),
    });

    // Synthetic chat note (Step 4) — keeps history coherent without
    // routing the pay action itself through the agent (which would
    // risk auto-paying on a different offer if the model misroutes).
    noteToChat(
      `Paid ${data.amount} ${data.currency} for order ${orderId.slice(0, 10)}… status=${data.status}.`
    );

    return data;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setError(msg);
    logEvent({
      group: 'settle.arc',
      bullet: 'fail',
      text: `error: ${msg}`,
      t: now(),
    });
    return null;
  }
}

export async function refreshTreasury() {
  const { setTreasury } = useSendero.getState();
  try {
    const res = await fetch('/api/treasury/balance');
    if (!res.ok) return;
    const data = await res.json();
    setTreasury(data);
  } catch {
    /* ignore */
  }
}
