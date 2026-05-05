# Next-wave ancillaries — seat/bag, free-API utilities, trip brief

**Status:** spec
**Owner:** tomas@sendero.travel
**Date:** 2026-05-04

Three small, high-leverage additions that share the existing tool/channel-render machinery. No new partners, no new contracts, no new schemas.

---

## 1. Seat selection + baggage upgrade

### What's already done

- `list_flight_ancillaries` (`packages/tools/src/list-flight-ancillaries.ts`) — READ side. Returns `{ bags, cfar, seats }` from Duffel `getOfferWithAncillaries`. Canonical shape.
- `book_flight` already accepts `services: [{ id, quantity }]` and forwards to Duffel.
- Duffel seat-map data structure mapped via `DuffelSeatOption`.

### What's missing

- **Tool surface** for the WRITE side (so the agent can attach a service without a custom prompt).
- **Channel render** for seat maps and bag selection.
- **Pricing surface** — services have their own price; needs same three-leg treatment as eSIM (wholesale / tenant markup / Sendero take).

### Tool plan

Two new tools, both thin facades over `book_flight`:

```ts
// packages/tools/src/select-seat.ts
select_seat: {
  input: { tripId, offerId, passengerId, seatServiceId },
  // Internally calls book_flight (or attaches to existing draft) with
  // services: [{ id: seatServiceId, quantity: 1 }]
  // Idempotent on (tripId, passengerId, segment)
}

// packages/tools/src/add-baggage.ts
add_baggage: {
  input: { tripId, offerId, passengerId, bagServiceId, quantity },
  // services: [{ id: bagServiceId, quantity }]
  // Idempotent on (tripId, passengerId, bagServiceId)
}
```

Both tools live behind the same `BOOKING_KINDS` price layer — markup goes under `markupConfig.flight_ancillaries` (don't invent a new kind, ancillaries are part of the flight booking).

### Channel render additions

Two new `ChannelMessage` kinds in `apps/app/lib/channel-render/types.ts`:

```ts
| ChannelMessageSeatMap        // grid of seats with cabin layout
| ChannelMessageAncillaryPicker // bag options + cfar option as a card
```

Channel mapping:
- **Operator (web):** AI Elements `Card` with custom `<SeatGrid />` for seat map; bullet card for ancillaries.
- **Slack:** Block Kit `actions` block with overflow menu for seats (Slack can't render a grid cleanly; collapse to "12A — $24, 14C — $18..."); buttons for bag tiers.
- **WhatsApp:** Interactive list message for both (max 10 rows; if seats > 10, group by row range).
- **Web traveler:** React seat-map component matching operator.

### CTAs

`ChannelCta.kind` extensions: `select_seat`, `add_bag`. Tap → calls the corresponding tool.

### Auto-trigger

When `book_flight` returns a confirmed booking and the offer included available services, the agent should ask once: "Want to pick seats or add bags?" Persona slab line in `sendero-dispatch-routing-rules`. No silent upsell — explicit prompt only.

### Risk

- **Duffel ancillary pricing volatility** — seat prices can change between offer and booking. `book_flight` already has the offer-expiry handling; reuse it.
- **Idempotency** — duplicate seat-pick must not double-charge. Key on `(tripId, passengerId, serviceId)` in `Booking.metadata.ancillaries`.

### Effort

~1 day — both tools share `book_flight` plumbing. Channel render is the long pole (seat grid component).

---

## 2. Free-API utilities (weather, FX, tipping)

Thin tool wrappers, no partner contracts, no auth.

### 2.1 `trip_weather_brief` — already shipped

`packages/tools/src/trip-weather-brief.ts` exists. Uses Google Maps Weather API. Skip.

**Optional polish:** add `forecast_days` arg (currently current-only) for trip-planning ("what's Lisbon like in 10 days?"). Google Maps Weather supports forecast endpoint.

### 2.2 `currency_convert` — new

```ts
currency_convert: {
  input: { amount: number, from: ISO4217, to: ISO4217, asOf?: Date },
  output: { converted: number, rate: number, source: string, fetchedAt: Date }
}
```

**Source:** Frankfurter (https://api.frankfurter.dev) — ECB rates, free, no key, daily granularity. Fallback: ExchangeRate-API free tier if Frankfurter is down.

**Caching:** Redis 1h TTL keyed `<env>:fx:<from>:<to>:<date>`. Rates don't change intraday at this granularity.

**Tool scope:** `read-only`, public — not in `PRIVILEGED_TOOLS`.

**Channel render:** plain `text` kind. No new shape.

### 2.3 `tipping_etiquette` — new

```ts
tipping_etiquette: {
  input: { countryIso2, scenario: 'restaurant' | 'taxi' | 'hotel_housekeeping' | 'hotel_porter' | 'tour_guide' | 'spa' },
  output: { recommendedPct?: number, recommendedFlat?: { amount, currency }, notes: string, source: 'sendero-curated' }
}
```

**Source:** static curated table. Tipping norms change slowly; bake into `packages/tools/src/data/tipping-etiquette.json`. Maintained manually. ~50 country × scenario rows.

**Why static:** every "tipping API" is either scraped Wikipedia or a one-off dataset that goes stale faster than our manual table. Skip the dependency.

**Channel render:** plain `text` kind. Maybe `card` if we want to show "$X recommended tip on $Y bill" with calculator.

### Effort for §2

- `currency_convert`: ~2 hours (tool + Redis cache + 4 tests).
- `tipping_etiquette`: ~3 hours (curate the table + tool wrapper). Most time goes to research, not code.
- Total: half a day.

---

## 3. Trip brief (TripIt-style aggregation)

Not a partner — a canonical `get_trip_brief` tool that joins everything Sendero already knows about a trip into one render. The agent already calls `get_active_trip`, `list_flight_ancillaries`, `trip_weather_brief`, eSIM details, etc. piecemeal. This wraps them.

### Tool

```ts
// packages/tools/src/get-trip-brief.ts
get_trip_brief: {
  input: { tripId: string, sections?: Array<'flights' | 'stays' | 'esim' | 'insurance' | 'weather' | 'requirements' | 'all'> },
  output: TripBrief
}

interface TripBrief {
  trip: { id, name, destination, departureDate, returnDate, status };
  flights: BookingSummary[];          // from Booking where kind='flight'
  stays: BookingSummary[];
  esims: EsimSummary[];               // from Esim
  insurance: InsuranceSummary[];      // when Faye lands
  weather?: TripWeatherBriefResult;   // current at destination
  requirements?: { visaRequired, eVisaAvailable, sourceUrl };  // from Sherpa cache
  alerts: Alert[];                    // delays, document expiry, etc.
  shareUrl: string;                   // public read-only invite link
}
```

### Channel render

New `ChannelMessage` kind:

```ts
| ChannelMessageTripBrief
```

- **Operator:** rich card with sectioned layout — flights collapsed to "outbound + return", stays as hotel name + nights, eSIM with status pill, weather chip.
- **Slack:** stacked block-kit cards (one per section), divider between.
- **WhatsApp:** interactive list message — each section a row, tap opens detail card. Plus a header card with the share URL.
- **Web:** full read-only page at `/trip/[shareToken]` (extends existing `/install/esim/[token]` pattern).

### Share URL

Reuses the OG share-image generator (`apps/app/app/api/og/share/route.tsx`). HMAC-signed token via `INVOICE_SIGNING_SECRET`. Public unfurl-friendly.

### Storage

No new tables. Pure read-side aggregator over `Trip` + `Booking` + `Esim` + (future) `Insurance` + cached Sherpa data.

### Effort

~2 days. Aggregation logic is ~half a day; share page + OG image is the long pole.

### Why this matters

- **WhatsApp recall.** Travelers ask "what's my trip again?" 3-5x mid-trip. One `get_trip_brief` call beats stitching three tool calls per turn.
- **Cross-channel handoff.** Slack operator asking "show me the trip" gets the same shape as the traveler in WhatsApp.
- **Share URL = viral surface.** Traveler forwards "here's my trip" to spouse → spouse hits the OG-imaged page → sees Sendero brand. Zero-CAC referral.

---

## Sequencing

1. **Day 1:** Currency convert + tipping etiquette + weather forecast extension. (Half day.)
2. **Day 2-3:** Seat + baggage tools + channel render shapes.
3. **Day 4-5:** Trip brief tool + share page + OG image.

Total: ~5 working days. Three separate PRs. None block each other.

---

## What this is NOT

- Not a new partner integration.
- Not a new package — all live under `packages/tools/src/` and existing channel-render layer.
- Not a new Prisma migration (trip-brief is read-only; seat/bag uses `Booking.metadata`).
- Not a billing change — seat/bag goes through existing flight pricing leg; free APIs have no cost to pass on.
