'use client';

/**
 * Client actions — wrap fetch() calls + update the Zustand store.
 *
 * Each action logs workflow events so the right-side console stays in sync
 * with what's happening on the wire.
 */

import { usePasillo, type SearchParams, type FlightOffer } from './store';

function now() {
  const d = new Date();
  return d.toTimeString().slice(0, 8);
}

export async function searchFlights(params: SearchParams) {
  const { setSearch, setOffers, setError, logEvent, updateLastEvent, clearLog } =
    usePasillo.getState();

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
    if (!res.ok) throw new Error(`search_failed: ${res.status}`);
    const data = await res.json();

    const offers: FlightOffer[] = data.offers || data.demoHint?.demoOffers || [];
    setOffers(offers);

    updateLastEvent('search.flights', { bullet: 'done' });
    logEvent({
      group: 'search.flights',
      bullet: 'done',
      text: `rankFares(<span class="v">${offers.length} results</span>)`,
      t: now(),
    });
    if (data.demoHint) {
      logEvent({
        group: 'search.flights',
        bullet: 'active',
        text: 'mode = <span class="v">demo fallback</span>',
        t: now(),
      });
    }

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
  passenger: { name: string; email: string },
) {
  const { selectOffer, setHoldOrder, setStatus, setError, logEvent } =
    usePasillo.getState();

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
      }),
    });
    if (!res.ok) throw new Error(`hold_failed: ${res.status}`);
    const data = await res.json();
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
  const { setPayment, setStatus, setError, logEvent } = usePasillo.getState();
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
    if (!res.ok) throw new Error(`pay_failed: ${res.status}`);
    const data = await res.json();
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
  const { setTreasury } = usePasillo.getState();
  try {
    const res = await fetch('/api/treasury/balance');
    if (!res.ok) return;
    const data = await res.json();
    setTreasury(data);
  } catch {
    /* ignore */
  }
}
