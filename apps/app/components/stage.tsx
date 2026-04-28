'use client';

/**
 * Stage — the center column. Renders the current booking artifact:
 *   · search form (idle state)
 *   · flight offers (after search)
 *   · hold + payment confirmation (after booking)
 *   · settlement breakdown (after payment)
 */

import { useState } from 'react';
import { useSendero } from './store';
import { holdFlight, payBooking, searchFlights } from './actions';
import { sendViaChat } from './chat-bridge';
import { StepRail, ErrorBanner } from './ui';
import { SettlePanel } from './settle-panel';
import { FundCard } from './fund-card';

export function Stage() {
  const search = useSendero(s => s.search);
  const offers = useSendero(s => s.offers);
  const status = useSendero(s => s.status);
  const holdOrder = useSendero(s => s.holdOrder);
  const payment = useSendero(s => s.payment);
  const onChainSettlement = useSendero(s => s.onChainSettlement);
  const selectedOfferId = useSendero(s => s.selectedOfferId);

  return (
    <div className="col" style={{ background: 'transparent' }}>
      <div className="col-body">
        <div className="stage pl-1 pr-3 mr-4">
          <StepRail />
          <ErrorBanner />

          {!search && status === 'idle' && <SearchForm />}

          {offers.length > 0 && status !== 'held' && status !== 'confirmed' && (
            <OffersCard
              offers={offers}
              selectedId={selectedOfferId}
              disabled={status === 'holding'}
            />
          )}

          {holdOrder && (
            <HoldCard
              holdOrder={holdOrder}
              paid={!!payment}
              paying={status === 'paying'}
              onPay={() => payBooking(holdOrder.orderId)}
            />
          )}

          {onChainSettlement && <SettlementCard />}

          {holdOrder && !onChainSettlement && <FundCard />}

          <SettlePanel />

          <HotelsCard />
        </div>
      </div>
    </div>
  );
}

function SearchForm() {
  const [origin, setOrigin] = useState('SFO');
  const [destination, setDestination] = useState('LHR');
  const [departureDate, setDepartureDate] = useState(() => isoDateOffset(14));
  const [returnDate, setReturnDate] = useState(() => isoDateOffset(21));
  const [passengers, setPassengers] = useState(1);
  const [cabinClass, setCabinClass] = useState<
    'economy' | 'premium_economy' | 'business' | 'first'
  >('premium_economy');
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const params = {
      origin: origin.toUpperCase(),
      destination: destination.toUpperCase(),
      departureDate,
      returnDate: returnDate || undefined,
      passengers,
      cabinClass,
    };
    // Prefer the agent path when a chat surface is mounted: the
    // search_flights tool result then lands in chat history and
    // rehydrates on reload, identical to a typed query. Headless
    // surfaces (storybook, install/slack) have no chat → sendViaChat
    // returns false and we fall through to the direct action.
    const cabinLabel = params.cabinClass.replace('_', ' ');
    const paxLabel = params.passengers === 1 ? '1 passenger' : `${params.passengers} passengers`;
    const returnPart = params.returnDate ? `, return ${params.returnDate}` : '';
    const text = `Use search_flights for ${params.origin} → ${params.destination} departing ${params.departureDate}${returnPart}, ${paxLabel}, ${cabinLabel}.`;
    if (sendViaChat(text)) return;
    searchFlights(params);
  };

  return (
    <div className="card">
      <div className="card-head">
        <span className="title">Search flights</span>
        <span className="tag faint">Live inventory</span>
      </div>
      <form
        onSubmit={submit}
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: 14,
          padding: 20,
        }}
      >
        <Field label="Origin (IATA)">
          <input
            value={origin}
            onChange={e => setOrigin(e.target.value.toUpperCase())}
            maxLength={3}
            className="stage-input"
          />
        </Field>
        <Field label="Destination (IATA)">
          <input
            value={destination}
            onChange={e => setDestination(e.target.value.toUpperCase())}
            maxLength={3}
            className="stage-input"
          />
        </Field>
        <Field label="Depart">
          <input
            type="date"
            value={departureDate}
            onChange={e => setDepartureDate(e.target.value)}
            className="stage-input"
          />
        </Field>
        <Field label="Return">
          <input
            type="date"
            value={returnDate}
            onChange={e => setReturnDate(e.target.value)}
            className="stage-input"
          />
        </Field>
        <Field label="Pax">
          <input
            type="number"
            min={1}
            max={9}
            value={passengers}
            onChange={e => setPassengers(Number(e.target.value))}
            className="stage-input"
          />
        </Field>
        <Field label="Cabin">
          <select
            value={cabinClass}
            onChange={e => setCabinClass(e.target.value as any)}
            className="stage-input"
          >
            <option value="economy">Economy</option>
            <option value="premium_economy">Premium Economy</option>
            <option value="business">Business</option>
            <option value="first">First</option>
          </select>
        </Field>
        <div
          style={{
            gridColumn: 'span 2',
            display: 'flex',
            justifyContent: 'flex-end',
            marginTop: 4,
          }}
        >
          <button type="submit" className="btn primary stage-submit">
            Search flights →
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: 'var(--text-dim)',
      }}
    >
      {label}
      {children}
    </label>
  );
}

function OffersCard({
  offers,
  selectedId,
  disabled,
}: {
  offers: any[];
  selectedId: string | null;
  disabled: boolean;
}) {
  const traveler = useSendero(s => s.traveler);
  const userAuth = useSendero(s => s.userAuth);

  return (
    <div className="card">
      <div className="card-head">
        <span className="title">Offers</span>
        <span className="tag faint">{offers.length} results</span>
      </div>
      <div className="itin-grid">
        {offers.map(offer => {
          const dep = offer.departure ? new Date(offer.departure).toISOString().slice(11, 16) : '—';
          const arr = offer.arrival ? new Date(offer.arrival).toISOString().slice(11, 16) : '—';
          const depDate = offer.departure
            ? new Date(offer.departure).toISOString().slice(0, 10)
            : '—';
          const isSelected = selectedId === offer.id;

          return (
            <div key={offer.id} className={`itin-leg ${isSelected ? 'selected' : ''}`}>
              <div className="itin-times">
                <div className="itin-tcol">
                  <div className="itin-time">{dep}</div>
                  <div className="itin-iata">{offer.originCode ?? 'DEP'}</div>
                </div>
                <div className="itin-path">
                  <span>{depDate}</span>
                  <div className="line" />
                  <span>
                    {offer.airlineIataCode
                      ? `${offer.airlineIataCode} · ${offer.duration?.replace('PT', '').toLowerCase()}`
                      : offer.airline}
                  </span>
                </div>
                <div className="itin-tcol">
                  <div className="itin-time">{arr}</div>
                  <div className="itin-iata">{offer.destinationCode ?? 'ARR'}</div>
                </div>
              </div>
              <div className="itin-info">
                <span className="route" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {offer.airlineLogoUrl && (
                    <img
                      src={offer.airlineLogoUrl}
                      alt={offer.airline}
                      width={20}
                      height={20}
                      style={{ objectFit: 'contain', flexShrink: 0 }}
                      onError={e => {
                        (e.currentTarget as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  )}
                  {offer.airline}
                </span>
                <span className="carrier">
                  {offer.cabinClass?.replace('_', ' ') || 'economy'} ·{' '}
                  {offer.stops === 0 ? 'nonstop' : `${offer.stops} stop(s)`}
                </span>
              </div>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  alignItems: 'flex-end',
                }}
              >
                <div className="itin-price">
                  <span className="amount">
                    {Number(offer.price).toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                  <span className="token">{offer.currency}</span>
                </div>
                {offer.holdable === false ? (
                  <span
                    title="Airline requires instant payment for this fare. Hold the seat is not available; book to commit."
                    style={{
                      padding: '6px 10px',
                      fontSize: 10,
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--text-dim)',
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      border: '1px solid var(--border)',
                    }}
                  >
                    Instant only
                  </span>
                ) : (
                  <button
                    className={`btn ${isSelected ? 'primary' : ''}`}
                    disabled={disabled}
                    onClick={() =>
                      holdFlight(offer.id, {
                        name: traveler.name,
                        email: traveler.email,
                        phone: userAuth?.phone,
                      })
                    }
                    style={{ padding: '6px 12px', fontSize: 10 }}
                  >
                    {disabled ? '…' : 'Hold seat →'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HoldCard({
  holdOrder,
  paid,
  paying,
  onPay,
}: {
  holdOrder: any;
  paid: boolean;
  paying: boolean;
  onPay: () => void;
}) {
  const deadline = holdOrder.paymentRequiredBy ? new Date(holdOrder.paymentRequiredBy) : null;

  return (
    <div className="card">
      <div className="card-head">
        <span className="title">Hold</span>
        <span className="tag ink">{holdOrder.bookingReference}</span>
      </div>
      <div className="settle-grid">
        <div className="settle-cell">
          <span className="k">Order</span>
          <span className="v mono-v">{holdOrder.orderId.slice(0, 16)}…</span>
        </div>
        <div className="settle-cell">
          <span className="k">Total</span>
          <span className="v">
            {Number(holdOrder.totalAmount).toLocaleString('en-US', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
          <span className="k">{holdOrder.totalCurrency}</span>
        </div>
        <div className="settle-cell">
          <span className="k">Pay by</span>
          <span className="v">
            {deadline ? deadline.toISOString().slice(11, 16) + ' UTC' : '—'}
          </span>
          <span className="k">then offer releases</span>
        </div>
        <div className="settle-cell">
          <span className="k">Status</span>
          <span className="v">{paid ? 'Ticketed' : paying ? 'Paying…' : 'Held'}</span>
          <span className="k">{paid ? 'seat confirmed' : 'awaiting balance'}</span>
        </div>
      </div>
      {!paid && (
        <div
          style={{
            display: 'flex',
            gap: 8,
            padding: 14,
            borderTop: '1px solid var(--border)',
            justifyContent: 'flex-end',
          }}
        >
          <button className="btn primary" disabled={paying} onClick={onPay}>
            {paying ? 'Settling on Arc…' : 'Pay from prepaid balance →'}
          </button>
        </div>
      )}
    </div>
  );
}

function SettlementCard() {
  const payment = useSendero(s => s.payment);
  const onChain = useSendero(s => s.onChainSettlement);
  const treasury = useSendero(s => s.treasury);

  const tokenLabel = payment?.currency || 'USDC';

  // The 7 on-chain tx labels in order
  const TX_LABELS = [
    'createJob',
    'setBudget',
    'approve USDC',
    'fund',
    'submit (PNR hash)',
    'complete',
    'giveFeedback',
  ];

  return (
    <div className="card">
      <div className="card-head">
        <span className="title">Settlement · ERC-8183 + ERC-8004</span>
        <span className="tag ink">Arc L2 · USDC</span>
      </div>

      {payment && (
        <div className="settle-grid">
          <div className="settle-cell">
            <span className="k">Total</span>
            <span className="v">
              {Number(payment.amount).toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
            <span className="k">{tokenLabel}</span>
          </div>
          <div className="settle-cell">
            <span className="k">Job ID</span>
            <span className="v">#{onChain?.jobId ?? '—'}</span>
            <span className="k">ERC-8183</span>
          </div>
          <div className="settle-cell">
            <span className="k">Block</span>
            <span className="v">#{treasury?.arc?.blockNumber || '—'}</span>
            <span className="k">chain {treasury?.arc?.chainId ?? 421}</span>
          </div>
          <div className="settle-cell">
            <span className="k">Deliverable</span>
            <span className="v mono-v">
              {onChain?.deliverableHash ? `${onChain.deliverableHash.slice(0, 10)}…` : '—'}
            </span>
            <span className="k">keccak256(PNR)</span>
          </div>
        </div>
      )}

      {onChain && (
        <div style={{ padding: '12px 16px' }}>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              letterSpacing: '0.08em',
              color: 'var(--text-dim)',
              textTransform: 'uppercase',
              marginBottom: 8,
            }}
          >
            On-chain transactions ({onChain.txHashes.length})
            {onChain.demo && (
              <span
                style={{
                  background: 'var(--accent-amber)',
                  color: 'var(--bg)',
                  padding: '1px 5px',
                  marginLeft: 8,
                  fontWeight: 600,
                }}
              >
                DEMO
              </span>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {onChain.txHashes.map((hash, i) => (
              <a
                key={i}
                href={`${onChain.explorerBase}/tx/${hash}`}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: 'grid',
                  gridTemplateColumns: '20px 1fr auto auto',
                  gap: 10,
                  alignItems: 'center',
                  padding: '6px 10px',
                  border: '1px solid var(--border)',
                  background: 'var(--bg-elev)',
                  textDecoration: 'none',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  color: 'var(--text)',
                  transition: 'all 0.12s',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.borderColor = 'var(--ink)';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)';
                }}
              >
                <span style={{ color: 'var(--accent-green)' }}>●</span>
                <span style={{ color: 'var(--text-dim)' }}>
                  #{i + 1} {TX_LABELS[i]}
                </span>
                <span style={{ color: 'var(--ink)' }}>
                  {hash.slice(0, 10)}…{hash.slice(-4)}
                </span>
                <span style={{ color: 'var(--text-faint)', fontSize: 10 }}>↗</span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function isoDateOffset(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/* ─── HotelsCard ────────────────────────────────────────────────────────── */

function HotelsCard() {
  const hotels = useSendero(s => s.hotels);
  const search = useSendero(s => s.hotelSearch);
  if (!hotels || hotels.length === 0) return null;

  const nights = search
    ? Math.max(
        1,
        Math.round(
          (new Date(search.checkOutDate).getTime() - new Date(search.checkInDate).getTime()) /
            (1000 * 60 * 60 * 24)
        )
      )
    : null;

  return (
    <div className="card">
      <div className="card-head">
        <span className="title">Stays</span>
        <span className="tag faint">
          {hotels.length} {hotels.length === 1 ? 'property' : 'properties'}
          {search ? ` · ${nights}n · ${search.location}` : ''}
        </span>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          gap: 12,
          padding: 14,
        }}
      >
        {hotels.map(h => (
          <HotelTile key={h.id} hotel={h} nights={nights} />
        ))}
      </div>
    </div>
  );
}

function HotelTile({
  hotel,
  nights,
}: {
  hotel: import('./store').HotelOffer;
  nights: number | null;
}) {
  const photo = hotel.photos?.[0] ?? null;
  const perNight =
    nights && nights > 0
      ? (Number(hotel.price) / nights).toLocaleString('en-US', {
          maximumFractionDigits: 0,
        })
      : null;

  const cancelLabel =
    hotel.cancellation === 'free'
      ? 'Free cancellation'
      : hotel.cancellation === 'partial'
        ? 'Partial refund'
        : hotel.cancellation === 'non_refundable'
          ? 'Non-refundable'
          : '—';

  const cancelColor =
    hotel.cancellation === 'free'
      ? 'var(--accent-green)'
      : hotel.cancellation === 'partial'
        ? 'var(--text-dim)'
        : 'var(--accent-rose)';

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        background: 'var(--bg-elev)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          aspectRatio: '4 / 3',
          background: 'var(--bg-sunk)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo}
            alt={hotel.name}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
            }}
            onError={e => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'grid',
              placeItems: 'center',
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: 'var(--text-faint)',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
            }}
          >
            {(hotel.city ?? 'stay').slice(0, 3).toUpperCase()} · PHOTO
          </div>
        )}
        {hotel.stars !== null && hotel.stars > 0 && (
          <div
            style={{
              position: 'absolute',
              top: 8,
              left: 8,
              padding: '2px 6px',
              background: 'var(--ink)',
              color: 'var(--bg-elev)',
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              letterSpacing: '0.08em',
            }}
          >
            {'★'.repeat(hotel.stars)}
          </div>
        )}
      </div>
      <div
        style={{
          padding: 10,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-sans)',
            fontWeight: 500,
            fontSize: 13,
            color: 'var(--text)',
            letterSpacing: '-0.005em',
            lineHeight: 1.3,
          }}
        >
          {hotel.name}
        </div>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: 'var(--text-dim)',
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
          }}
        >
          {hotel.city ?? '—'}
          {hotel.reviewScore ? ` · ${hotel.reviewScore.toFixed(1)}/10` : ''}
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            marginTop: 4,
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: cancelColor,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            {cancelLabel}
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
            <span
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 16,
                fontWeight: 500,
                color: 'var(--text)',
                letterSpacing: '-0.01em',
              }}
            >
              {Number(hotel.price).toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  color: 'var(--text-dim)',
                  marginLeft: 4,
                  letterSpacing: '0.06em',
                }}
              >
                {hotel.currency}
              </span>
            </span>
            {perNight && (
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  color: 'var(--text-faint)',
                  letterSpacing: '0.04em',
                }}
              >
                {perNight} {hotel.currency}/nt
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
